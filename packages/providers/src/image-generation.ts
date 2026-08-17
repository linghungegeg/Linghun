import { LinghunError } from "@linghun/core";
import {
  DEFAULT_MINIMAX_IMAGE_MODEL,
  MINIMAX_IMAGE_MODELS,
  MINIMAX_IMAGE_URL_TTL_HOURS,
  isMiniMaxImageModel,
  readPositiveIntEnv,
  resolveMiniMaxImageEndpoint,
  resolveMiniMaxRegion,
} from "@linghun/shared";

/**
 * Image generation runs on its own REST surface: one POST call returns finished images
 * instead of a token stream, so it does not go through the streaming Provider contract.
 * This module owns the model registry, the request schema and the response decoding.
 */

export type ImageOutputFormat = "url" | "base64";

export const IMAGE_OUTPUT_FORMATS: readonly ImageOutputFormat[] = ["url", "base64"];

export const IMAGE_ASPECT_RATIOS: readonly string[] = [
  "1:1",
  "16:9",
  "4:3",
  "3:2",
  "2:3",
  "3:4",
  "9:16",
  "21:9",
];

export const IMAGE_PROMPT_MAX_LENGTH = 1500;
export const IMAGE_MIN_DIMENSION = 512;
export const IMAGE_MAX_DIMENSION = 2048;
export const IMAGE_DIMENSION_MULTIPLE = 8;
export const IMAGE_MIN_COUNT = 1;
export const IMAGE_MAX_COUNT = 9;

export type ImageGenerationModelInfo = {
  id: string;
  displayName: string;
  providerId: string;
  outputFormats: readonly ImageOutputFormat[];
  /** Hours before a returned image URL expires; bytes must be persisted before that. */
  urlTtlHours: number;
};

export const minimaxImageModels: ImageGenerationModelInfo[] = MINIMAX_IMAGE_MODELS.map((id) => ({
  id,
  displayName: id === DEFAULT_MINIMAX_IMAGE_MODEL ? "MiniMax Image 01" : "MiniMax Image 01 Live",
  providerId: "minimax",
  outputFormats: IMAGE_OUTPUT_FORMATS,
  urlTtlHours: MINIMAX_IMAGE_URL_TTL_HOURS,
}));

export const defaultImageModelId: string = DEFAULT_MINIMAX_IMAGE_MODEL;

export function findKnownImageModel(modelId: string): ImageGenerationModelInfo | undefined {
  return minimaxImageModels.find((model) => model.id === modelId);
}

export function listKnownImageModels(): ImageGenerationModelInfo[] {
  return [...minimaxImageModels];
}

/** Request schema in project casing; `createImageGenerationRequestBody` maps it to the wire. */
export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  responseFormat?: ImageOutputFormat;
  seed?: number;
  /** How many images one call returns. */
  count?: number;
  promptOptimizer?: boolean;
};

export type ImageGenerationResponse = {
  imageUrls: string[];
  imagesBase64: string[];
  successCount: number;
  failedCount: number;
  statusCode?: number;
  statusMessage?: string;
  traceId?: string;
  /** Hours before the returned URLs expire, when the call asked for URLs. */
  urlTtlHours?: number;
};

const IMAGE_REQUEST_TIMEOUT_MS = () =>
  readPositiveIntEnv("LINGHUN_PROVIDER_TIMEOUT_MS", 120_000);

function invalidRequest(message: string, suggestion: string): LinghunError {
  return new LinghunError({
    code: "IMAGE_REQUEST_INVALID",
    message: `Image generation request is invalid: ${message}`,
    suggestion,
    recoverable: true,
  });
}

function assertDimension(label: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw invalidRequest(`${label} must be an integer`, `Pass an integer ${label} in pixels.`);
  }
  if (value < IMAGE_MIN_DIMENSION || value > IMAGE_MAX_DIMENSION) {
    throw invalidRequest(
      `${label} must be between ${IMAGE_MIN_DIMENSION} and ${IMAGE_MAX_DIMENSION}`,
      `Use a ${label} inside the supported pixel range.`,
    );
  }
  if (value % IMAGE_DIMENSION_MULTIPLE !== 0) {
    throw invalidRequest(
      `${label} must be divisible by ${IMAGE_DIMENSION_MULTIPLE}`,
      `Round ${label} to the nearest multiple of ${IMAGE_DIMENSION_MULTIPLE}.`,
    );
  }
}

/**
 * Validates the request and maps it to the wire body. Only fields the caller actually set
 * are emitted, so provider-side defaults stay in force and nothing is silently fixed.
 */
export function createImageGenerationRequestBody(
  request: ImageGenerationRequest,
): Record<string, unknown> {
  const model = request.model.trim();
  if (!model) {
    throw invalidRequest("model is required", "Set an image model on the image role route.");
  }
  if (!findKnownImageModel(model)) {
    throw invalidRequest(
      `model ${model} is not a known image model`,
      `Known image models: ${MINIMAX_IMAGE_MODELS.join(", ")}.`,
    );
  }
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw invalidRequest("prompt is required", "Describe the image you want to generate.");
  }
  if (prompt.length > IMAGE_PROMPT_MAX_LENGTH) {
    throw invalidRequest(
      `prompt exceeds ${IMAGE_PROMPT_MAX_LENGTH} characters`,
      "Shorten the prompt and retry.",
    );
  }
  if (request.aspectRatio !== undefined && !IMAGE_ASPECT_RATIOS.includes(request.aspectRatio)) {
    throw invalidRequest(
      `aspect_ratio ${request.aspectRatio} is not supported`,
      `Supported aspect ratios: ${IMAGE_ASPECT_RATIOS.join(", ")}.`,
    );
  }
  // width and height only take effect as a pair; a lone value would be dropped server side.
  if ((request.width === undefined) !== (request.height === undefined)) {
    throw invalidRequest(
      "width and height must be sent together",
      "Provide both width and height, or use aspectRatio instead.",
    );
  }
  if (request.width !== undefined) assertDimension("width", request.width);
  if (request.height !== undefined) assertDimension("height", request.height);
  if (request.responseFormat !== undefined && !IMAGE_OUTPUT_FORMATS.includes(request.responseFormat)) {
    throw invalidRequest(
      `response_format ${request.responseFormat} is not supported`,
      `Supported output formats: ${IMAGE_OUTPUT_FORMATS.join(", ")}.`,
    );
  }
  if (request.count !== undefined) {
    if (
      !Number.isInteger(request.count) ||
      request.count < IMAGE_MIN_COUNT ||
      request.count > IMAGE_MAX_COUNT
    ) {
      throw invalidRequest(
        `count must be an integer between ${IMAGE_MIN_COUNT} and ${IMAGE_MAX_COUNT}`,
        "Request a supported number of images per call.",
      );
    }
  }
  if (request.seed !== undefined && !Number.isInteger(request.seed)) {
    throw invalidRequest("seed must be an integer", "Pass an integer seed for reproducible runs.");
  }
  const body: Record<string, unknown> = { model, prompt };
  if (request.aspectRatio !== undefined) body.aspect_ratio = request.aspectRatio;
  if (request.width !== undefined) body.width = request.width;
  if (request.height !== undefined) body.height = request.height;
  if (request.responseFormat !== undefined) body.response_format = request.responseFormat;
  if (request.seed !== undefined) body.seed = request.seed;
  if (request.count !== undefined) body.n = request.count;
  if (request.promptOptimizer !== undefined) body.prompt_optimizer = request.promptOptimizer;
  return body;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

// The counters are typed as integers but are returned quoted in practice, so accept both.
function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Decodes the JSON body. The transport can answer HTTP 200 while reporting a failure in
 * `base_resp.status_code`, so a non-zero status is surfaced as an error rather than as an
 * empty success.
 */
export function decodeImageGenerationResponse(parsed: unknown): ImageGenerationResponse {
  const root = asRecord(parsed);
  if (!root) {
    throw new LinghunError({
      code: "IMAGE_RESPONSE_MALFORMED",
      message: "Image generation response was not a JSON object.",
      suggestion: "Check the configured base URL; a gateway may be rewriting the response.",
      recoverable: true,
    });
  }
  const baseResp = asRecord(root.base_resp);
  const statusCode = asOptionalNumber(baseResp?.status_code);
  const statusMessage = asOptionalString(baseResp?.status_msg);
  if (statusCode !== undefined && statusCode !== 0) {
    throw new LinghunError({
      code: "IMAGE_GENERATION_REJECTED",
      message: `Image generation failed: status ${statusCode}${statusMessage ? ` (${statusMessage})` : ""}.`,
      suggestion:
        "Check the API key, the account balance and whether the prompt was flagged, then retry.",
      recoverable: true,
    });
  }
  const data = asRecord(root.data);
  const imageUrls = asStringArray(data?.image_urls);
  const imagesBase64 = asStringArray(data?.image_base64);
  const metadata = asRecord(root.metadata);
  const failedCount = asCount(metadata?.failed_count);
  const successCount = asCount(metadata?.success_count);
  if (imageUrls.length === 0 && imagesBase64.length === 0) {
    throw new LinghunError({
      code: "IMAGE_RESPONSE_EMPTY",
      message: `Image generation returned no images (failed count ${failedCount}).`,
      suggestion: "Rewrite the prompt and retry; every requested image may have been rejected.",
      recoverable: true,
    });
  }
  return {
    imageUrls,
    imagesBase64,
    successCount: successCount || imageUrls.length + imagesBase64.length,
    failedCount,
    statusCode,
    statusMessage,
    traceId: asOptionalString(root.id),
    urlTtlHours: imageUrls.length > 0 ? MINIMAX_IMAGE_URL_TTL_HOURS : undefined,
  };
}

export type ImageGenerationCall = {
  apiKey?: string;
  /** Chat base URL of the routed provider; selects the matching regional image endpoint. */
  baseUrl?: string;
  request: ImageGenerationRequest;
  signal?: AbortSignal;
};

export function resolveImageEndpoint(baseUrl?: string): string {
  return resolveMiniMaxImageEndpoint(baseUrl);
}

export function resolveImageRegion(baseUrl?: string): string {
  return resolveMiniMaxRegion(baseUrl);
}

export function isKnownImageModel(modelId: string): boolean {
  return isMiniMaxImageModel(modelId);
}

/** Sends one image generation call and returns the decoded images. */
export async function generateImage(call: ImageGenerationCall): Promise<ImageGenerationResponse> {
  const apiKey = call.apiKey?.trim();
  if (!apiKey) {
    throw new LinghunError({
      code: "MODEL_API_KEY_MISSING",
      message: "Image generation needs an API key on the routed provider.",
      suggestion: "Set the provider api_key in provider.env, then run /model doctor.",
      recoverable: true,
    });
  }
  const body = createImageGenerationRequestBody(call.request);
  const endpoint = resolveImageEndpoint(call.baseUrl);
  const timeoutMs = IMAGE_REQUEST_TIMEOUT_MS();
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: call.signal
        ? AbortSignal.any([call.signal, timeoutController.signal])
        : timeoutController.signal,
    });
  } catch (error) {
    if (timeoutController.signal.aborted && !call.signal?.aborted) {
      throw new LinghunError({
        code: "PROVIDER_REQUEST_TIMEOUT",
        message: `Image generation timed out after ${timeoutMs}ms.`,
        suggestion: "Raise LINGHUN_PROVIDER_TIMEOUT_MS or retry with fewer images.",
        recoverable: true,
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    throw new LinghunError({
      code: authFailure ? "PROVIDER_API_KEY_ERROR" : "PROVIDER_HTTP_ERROR",
      message: `Image generation failed: HTTP ${response.status}.`,
      suggestion: authFailure
        ? "Check that the provider api_key is valid for the image endpoint."
        : "Run /model doctor and confirm the image model and base URL are accepted.",
      recoverable: true,
    });
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  return decodeImageGenerationResponse(parsed);
}
