import { describe, expect, it } from "vitest";
import { resolveWorkflowDispatchRuntimePolicy } from "./workflow-command-runtime.js";

describe("workflow dispatch runtime policy", () => {
  const action = (mode: "run" | "ask" | "degrade" | "stop") => ({
    mode,
    reason: `${mode} reason`,
    shouldAsk: mode === "ask",
    shouldDegrade: mode === "degrade",
    shouldStop: mode === "stop",
  });

  it("runs when the scheduler allows workflow dispatch", () => {
    expect(resolveWorkflowDispatchRuntimePolicy(action("run"))).toEqual({ action: "run" });
  });

  it("blocks workflow dispatch when the scheduler asks or stops", () => {
    expect(resolveWorkflowDispatchRuntimePolicy(action("ask"))).toEqual({
      action: "block",
      reason: "ask reason",
    });
    expect(resolveWorkflowDispatchRuntimePolicy(action("stop"))).toEqual({
      action: "block",
      reason: "stop reason",
    });
  });

  it("degrades workflow dispatch to plan-only", () => {
    expect(resolveWorkflowDispatchRuntimePolicy(action("degrade"))).toEqual({
      action: "plan-only",
      reason: "degrade reason",
    });
  });
});
