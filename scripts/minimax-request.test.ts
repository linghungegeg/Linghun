import { defaultConfig, resolveModelSelection } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ModelRequest, OpenAiCompatibleProvider, type ProviderConfig } from "@linghun/providers";

const messages: ModelRequest["messages"] = [
  { role: "system", content: "Be helpful." },
  { role: "user", content: "Read the file." },
  { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "Read", input: { path: "a.txt" } }] },
  { role: "tool", tool_call_id: "call-1", content: "File contents" },
];
const request: ModelRequest = {
  messages,
  tools: [{ name: "Read", description: "Read a file", inputSchema: { type: "object" } }],
  maxOutputTokens: 4096,
};

async function capture(config: ProviderConfig, input: ModelRequest = request) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(
    config.endpointProfile === "anthropic_messages"
      ? 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
      : 'data: {"id":"test","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { "content-type": "text/event-stream" } },
  ));
  vi.stubGlobal("fetch", fetchMock);
  const provider = new OpenAiCompatibleProvider(config);
  const events = [];
  for await (const event of provider.stream(input)) events.push(event);
  expect(events.some((event) => event.type === "assistant_text_delta")).toBe(true);
  expect(events.some((event) => event.type === "message_stop")).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  return { url, body: JSON.parse(String(init.body)) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

for (const host of ["api.minimax.io", "api.minimaxi.com"]) {
  for (const endpointProfile of ["chat_completions", "anthropic_messages"] as const) {
    const anthropic = endpointProfile === "anthropic_messages";
    const config: ProviderConfig = {
      ...defaultConfig.providers.minimax,
      id: "minimax",
      apiKey: "test-key",
      baseUrl: `https://${host}/${anthropic ? "anthropic" : "v1"}`,
      endpointProfile,
    };
    describe(`${host} ${endpointProfile}`, () => {
      it.each([undefined, "Low", "Medium", "High", "XHigh", "Max"])(
        "sends the configured Flash default with effort %s at the HTTP boundary",
        async (reasoningLevel) => {
          const { url, body } = await capture(config, { ...request, reasoningLevel });
          expect(url).toBe(`https://${host}/${anthropic ? "anthropic/v1/messages" : "v1/chat/completions"}`);
          expect(body.model).toBe("MiniMax-M3.1-Flash");
          expect(body.stream).toBe(true);
          expect(body.max_tokens).toBe(4096);
          expect(body.service_tier).toBeUndefined();
          expect(body.reasoning_split).toBeUndefined();
          expect(body.reasoning).toBeUndefined();
          expect(body.web_search_options).toBeUndefined();
          expect(body.tools).toHaveLength(1);
          if (anthropic) {
            expect(body.thinking).toEqual({ type: "adaptive" });
            expect(body.output_config).toEqual(reasoningLevel ? { effort: reasoningLevel.toLowerCase() } : undefined);
            expect(body.reasoning_effort).toBeUndefined();
            expect(body.messages.at(-1).content).toContainEqual({ type: "tool_result", tool_use_id: "call-1", content: "File contents" });
          } else {
            expect(body.reasoning_effort).toBe(reasoningLevel?.toLowerCase());
            expect(body.output_config).toBeUndefined();
            expect(body.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call-1", content: "File contents" });
          }
        },
      );

      it("decodes Flash reasoning and tool responses and replays the resulting tool history", async () => {
        const stream = anthropic
          ? [
              'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-tool"}}\n\n',
              'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Read the file"}}\n\n',
              'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"Read","input":{}}}\n\n',
              `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":"a.txt"}' } })}\n\n`,
              'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
              'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
              'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join("")
          : [
              'data: {"id":"msg-tool","choices":[{"delta":{"reasoning_content":"Read the file"}}]}\n\n',
              `data: ${JSON.stringify({ id: "msg-tool", choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "Read", arguments: '{"path":"a.txt"}' } }] }, finish_reason: "tool_calls" }] })}\n\n`,
              'data: [DONE]\n\n',
            ].join("");
        vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        })));
        const events = [];
        for await (const event of new OpenAiCompatibleProvider(config).stream(request)) events.push(event);
        expect(events).toContainEqual({ type: "assistant_thinking_delta", id: "msg-tool", text: "Read the file" });
        const tool = events.find((event) => event.type === "tool_use");
        expect(tool).toEqual({ type: "tool_use", id: "call-1", name: "Read", input: { path: "a.txt" } });
        expect(events.some((event) => event.type === "error")).toBe(false);
        expect(events.some((event) => event.type === "message_stop")).toBe(true);
        if (!tool || tool.type !== "tool_use") throw new Error("Missing tool response");
        const { body } = await capture(config, {
          ...request,
          messages: [
            messages[1],
            { role: "assistant", content: "", toolCalls: [{ id: tool.id, name: tool.name, input: tool.input }] },
            { role: "tool", tool_call_id: tool.id, content: "File contents" },
          ],
        });
        expect(anthropic ? body.messages.at(-1).content[0].tool_use_id : body.messages.at(-1).tool_call_id).toBe(tool.id);
      });

      it("uses the Flash output limit when no lower limit is configured", async () => {
        const { body } = await capture(config, { messages });
        expect(body.max_tokens).toBe(524_288);
      });

      it.each(["none", "disabled"])("rejects Flash effort %s before sending HTTP", async (reasoningLevel) => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const provider = new OpenAiCompatibleProvider(config);
        await expect(async () => {
          for await (const _event of provider.stream({ ...request, reasoningLevel })) { /* consume */ }
        }).rejects.toMatchObject({ code: "MODEL_REASONING_LEVEL_UNSUPPORTED" });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it.each(["MiniMax-M3", "MiniMax-M2.7", "saved-custom-model"])(
        "preserves explicitly saved and per-request model %s",
        async (model) => {
          const saved = { ...config, model };
          expect(resolveModelSelection(`minimax:${model}`, { minimax: saved }).model).toBe(model);
          expect((await capture(saved)).body.model).toBe(model);
          expect((await capture(config, { ...request, model })).body.model).toBe(model);
        },
      );

      it("keeps M3 reasoning model-controlled without sending effort or budget", async () => {
        const { body } = await capture(config, { ...request, model: "MiniMax-M3", reasoningLevel: "High" });
        expect(body.reasoning_effort).toBeUndefined();
        expect(body.output_config).toBeUndefined();
        expect(body.reasoning).toBeUndefined();
        expect(body.thinking).toEqual(anthropic ? { type: "adaptive" } : undefined);
      });

      it("retains M3 protocol defaults", async () => {
        const { body } = await capture(config, { ...request, model: "MiniMax-M3" });
        expect(body.thinking).toBeUndefined();
        expect(body.reasoning_effort).toBeUndefined();
        expect(body.output_config).toBeUndefined();
      });
    });
  }
}

it.each(["MiniMax-M3", "MiniMax-M2.7", "saved-custom-model"])(
  "retains the model environment override %s through the HTTP request",
  async (model) => {
    vi.stubEnv("LINGHUN_MINIMAX_MODEL", model);
    vi.resetModules();
    const { defaultConfig: configured } = await import("@linghun/config");
    const { body } = await capture({ ...configured.providers.minimax, id: "minimax", apiKey: "test-key" });
    expect(body.model).toBe(model);
  },
);

it("does not apply direct Flash reasoning rules to custom gateways", async () => {
  const { body } = await capture({
    ...defaultConfig.providers.minimax,
    id: "custom",
    apiKey: "test-key",
    baseUrl: "https://gateway.example/v1",
    compatibilityProfile: "permissive_openai_compatible",
  }, { ...request, reasoningLevel: "High" });
  expect(body.reasoning).toEqual({ effort: "high" });
  expect(body.reasoning_effort).toBeUndefined();
});
