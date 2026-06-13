import { describe, expect, it } from "vitest";
import {
  PROMPT_COMMANDS,
  buildPromptCommandUserText,
  findPromptCommand,
} from "./prompt-command-runtime.js";
import { findSlashCommandRegistryEntry } from "./natural-command-bridge.js";

describe("prompt-command-runtime", () => {
  it("registers Phase D prompt commands as model-driven handlers", () => {
    expect(Object.keys(PROMPT_COMMANDS)).toEqual(
      expect.arrayContaining([
        "/commit",
        "/init",
        "/security-review",
        "/commit-push-pr",
        "/init-verifiers",
      ]),
    );
    expect(findPromptCommand("/security-review")?.promptCommand).toBe(true);
    expect(findSlashCommandRegistryEntry("/security-review")?.promptCommand).toBe(true);
  });

  it("builds a bounded prompt that preserves gates and user args", () => {
    const prompt = buildPromptCommandUserText("/commit-push-pr", ["--draft"], "zh-CN");
    expect(prompt).toContain("PromptCommand /commit-push-pr");
    expect(prompt).toContain("CommandArgs=--draft");
    expect(prompt).toContain("不得绕过 Start Gate");
    expect(prompt).toContain("permission");
  });
});
