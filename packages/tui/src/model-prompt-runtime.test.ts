import { describe, expect, it } from "vitest";
import { sanitizeMainScreenLeakage } from "./model-prompt-runtime.js";

describe("D.14D sanitizeMainScreenLeakage", () => {
  it("returns text unchanged when no internal tokens are present", () => {
    const text = "这是给用户的人话回答，没有内部字段。";
    expect(sanitizeMainScreenLeakage(text, "zh-CN")).toBe(text);
  });

  it("strips a RuntimeStatusForModel dump line and adds a hint", () => {
    const text =
      '好的，这是状态：\nRuntimeStatusForModel={"memory":{"linghunMd":"missing"}}\n以上。';
    const result = sanitizeMainScreenLeakage(text, "zh-CN");
    expect(result).not.toContain("RuntimeStatusForModel");
    expect(result).not.toContain('"linghunMd"');
    expect(result).toContain("内部运行时上下文已从主屏省略");
  });

  it("strips ControlledMemorySummary / MemoryBoundary / EvidenceSummary / CommandCapabilitySummary echoes", () => {
    const text = [
      "解释如下：",
      "ControlledMemorySummary=accepted:0 candidates:0",
      "MemoryBoundary=acceptedOnly; topK=3; candidateOnlyLearning; doNotWriteLongTermMemoryWithoutExplicitMemoryAccept",
      "EvidenceSummary=[]",
      "CommandCapabilitySummary=",
      "/help Help: risk=readonly",
    ].join("\n");
    const result = sanitizeMainScreenLeakage(text, "zh-CN");
    expect(result).not.toContain("ControlledMemorySummary");
    expect(result).not.toContain("MemoryBoundary");
    expect(result).not.toContain("EvidenceSummary");
    expect(result).not.toContain("CommandCapabilitySummary");
    expect(result).not.toContain("doNotWriteLongTermMemoryWithoutExplicitMemoryAccept");
  });

  it("strips bare doNotWriteLongTermMemoryWithoutExplicitMemoryAccept token even without '='", () => {
    const text = "记忆策略：doNotWriteLongTermMemoryWithoutExplicitMemoryAccept 生效中。";
    const result = sanitizeMainScreenLeakage(text, "zh-CN");
    expect(result).not.toContain("doNotWriteLongTermMemoryWithoutExplicitMemoryAccept");
  });

  it("naturalizes internal tool labels without dropping the conservative conclusion", () => {
    const text =
      "没有查看过项目状态、代码变更或索引状态。\n没有运行过 RunVerification 来验证测试通过或构建成功。";
    const result = sanitizeMainScreenLeakage(text, "zh-CN");
    expect(result).not.toContain("RunVerification");
    expect(result).toContain("没有运行过 验证命令 来验证测试通过或构建成功。");
    expect(result).toContain("内部运行时上下文已从主屏省略");
  });

  it("uses an English hint for en-US", () => {
    const text =
      'Status:\nRuntimeStatusForModel={"index":{"status":"ready"}}\nRunVerification was not called.';
    const result = sanitizeMainScreenLeakage(text, "en-US");
    expect(result).not.toContain("RuntimeStatusForModel");
    expect(result).not.toContain("RunVerification");
    expect(result).toContain("verification command was not called");
    expect(result).toContain("Internal runtime context was omitted");
  });

  it("strips Phase 7.7 typed policy signal labels if a model echoes them", () => {
    const text = [
      "PolicyDecision={}",
      'permissionSignal: {"requireExplicitGate":true}',
      'modelRouteSignal: {"suggestedRole":"verifier"}',
      'verificationSignal: {"recommendedLevel":"focused"}',
      "给用户的人话结论。",
    ].join("\n");
    const result = sanitizeMainScreenLeakage(text, "zh-CN");

    expect(result).not.toContain("permissionSignal");
    expect(result).not.toContain("modelRouteSignal");
    expect(result).not.toContain("verificationSignal");
    expect(result).toContain("内部运行时上下文已从主屏省略");
    expect(result).toContain("给用户的人话结论。");
  });

  it("does not falsely strip ordinary prose that merely mentions the word model or memory", () => {
    const text = "你的 model 配置看起来正常，memory 也没问题。";
    expect(sanitizeMainScreenLeakage(text, "zh-CN")).toBe(text);
  });
});
