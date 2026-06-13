import { describe, expect, it } from "vitest";
import { ModelGateway, type Provider } from "./index.js";

describe("ModelGateway countMessagesTokensWithAPI", () => {
  it("calls provider countTokens when available", async () => {
    const provider: Provider = {
      id: "mock",
      displayName: "Mock",
      supports: { streaming: true, usage: true },
      listModels: async () => [],
      countTokens: async () => ({ source: "api", inputTokens: 42 }),
      stream: async function* () {},
    };
    const gateway = new ModelGateway([provider]);

    await expect(
      gateway.countMessagesTokensWithAPI("mock", {
        messages: [{ role: "user", content: "hello" }],
        model: "mock-model",
      }),
    ).resolves.toMatchObject({ source: "api", inputTokens: 42 });
  });

  it("returns unavailable for providers without a countTokens API", async () => {
    const provider: Provider = {
      id: "mock",
      displayName: "Mock",
      supports: { streaming: true, usage: true },
      listModels: async () => [],
      stream: async function* () {},
    };
    const gateway = new ModelGateway([provider]);

    await expect(
      gateway.countMessagesTokensWithAPI("mock", {
        messages: [{ role: "user", content: "hello" }],
        model: "mock-model",
      }),
    ).resolves.toMatchObject({ source: "unavailable" });
  });
});
