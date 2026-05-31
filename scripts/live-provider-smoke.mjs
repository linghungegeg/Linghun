process.exitCode = await main();

async function main() {
  if (!process.env.LINGHUN_DEEPSEEK_API_KEY && !process.env.LINGHUN_OPENAI_API_KEY) {
    console.log(
      "SKIPPED live provider smoke: set LINGHUN_DEEPSEEK_API_KEY or LINGHUN_OPENAI_API_KEY",
    );
    return 0;
  }

  if (process.env.LINGHUN_OPENAI_API_KEY && !process.env.LINGHUN_OPENAI_MODEL) {
    console.error(
      "FAIL live provider smoke: LINGHUN_OPENAI_API_KEY is set but LINGHUN_OPENAI_MODEL is missing; set an explicit real model, no placeholder is used.",
    );
    return 1;
  }

  if (
    process.env.LINGHUN_DEEPSEEK_API_KEY &&
    !process.env.LINGHUN_OPENAI_API_KEY &&
    !process.env.LINGHUN_DEEPSEEK_MODEL
  ) {
    console.error(
      "FAIL live provider smoke: LINGHUN_DEEPSEEK_API_KEY is set but LINGHUN_DEEPSEEK_MODEL is missing; set an explicit real model, no placeholder is used.",
    );
    return 1;
  }

  const { DeepSeekProvider, OpenAiCompatibleProvider, normalizeProviderError } = await import(
    "../packages/providers/dist/index.js"
  );

  const provider = process.env.LINGHUN_OPENAI_API_KEY
    ? new OpenAiCompatibleProvider({
        id: "openai-compatible",
        type: "openai-compatible",
        baseUrl: process.env.LINGHUN_OPENAI_BASE_URL,
        apiKey: process.env.LINGHUN_OPENAI_API_KEY,
        model: process.env.LINGHUN_OPENAI_MODEL,
        supportsTools: false,
      })
    : new DeepSeekProvider({
        apiKey: process.env.LINGHUN_DEEPSEEK_API_KEY,
        model: process.env.LINGHUN_DEEPSEEK_MODEL,
        supportsTools: false,
      });

  let text = "";
  let tool = false;
  let hadReasoning = false;

  try {
    for await (const event of provider.stream(
      {
        messages: [{ role: "user", content: "用一句中文回复：Linghun live provider smoke" }],
        maxOutputTokens: 64,
      },
      new AbortController().signal,
    )) {
      if (event.type === "assistant_text_delta") text += event.text;
      if (event.type === "assistant_thinking_delta") hadReasoning = true;
      if (event.type === "tool_use") tool = true;
      if (event.type === "error") {
        printProviderFailure(event.error);
        return 1;
      }
    }
  } catch (error) {
    printProviderFailure(normalizeProviderError(error));
    return 1;
  }

  if (text) {
    console.log("PASS live provider smoke: text response");
    return 0;
  }

  if (tool) {
    console.log("PASS live provider smoke: tool response");
    return 0;
  }

  if (hadReasoning) {
    console.log(
      "PASS live provider smoke: reasoning stream observed; no final text within smoke budget",
    );
    return 0;
  }

  console.error("FAIL live provider smoke: empty provider response");
  return 1;
}

function printProviderFailure(error) {
  console.error(`FAIL live provider smoke: ${error.code}: ${error.message}`);
  if (error.suggestion) {
    console.error(`suggestion: ${error.suggestion}`);
  }
}
