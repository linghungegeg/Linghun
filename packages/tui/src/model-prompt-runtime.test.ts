import { describe, expect, it } from "vitest";
import type { TuiContext } from "./index.js";
import { createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import {
  createModelSystemPromptSegments,
  sanitizeMainScreenLeakage,
} from "./model-prompt-runtime.js";
import { createCacheState } from "./tui-state-runtime.js";

function createPromptTestContext(overrides: Partial<TuiContext> = {}): TuiContext {
  return {
    language: "zh-CN",
    projectPath: "F:\\synthetic-project",
    model: "gpt-test",
    permissions: { recentDenied: [] },
    evidence: [
      {
        id: "ev-1",
        kind: "command",
        source: "test",
        summary: "focused verification passed",
        supportsClaims: ["test_claim"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    solutionCompleteness: createSolutionCompletenessStatus(),
    mcp: { enabled: false, servers: [], tools: [] },
    skills: { enabled: false, skills: [], trustedIds: [], disabledIds: [], errors: [] },
    plugins: { enabled: false, plugins: [], trustedIds: [], disabledIds: [], errors: [] },
    config: { mcp: { servers: {} } },
    memory: {
      projectRulesPath: "",
      projectRulesExists: false,
      projectRulesSummary: "",
      projectDir: "",
      userDir: "",
      sessionDir: "",
      candidates: [],
      accepted: [],
      rejected: [],
      disabled: [],
      retired: [],
      learningMode: "off",
    },
    cache: createCacheState("F:\\synthetic-project", "gpt-test"),
    discoveredDeferredToolNames: new Set<string>(),
    ...overrides,
  } as unknown as TuiContext;
}

describe("D.14D sanitizeMainScreenLeakage", () => {
  it("keeps dynamic runtime context out of the stable system prompt segment", () => {
    const context = createPromptTestContext();
    const segments = createModelSystemPromptSegments(
      "检查缓存机制",
      context,
      { index: { status: "ready" } },
      "ArchitectureDirective=dynamic architecture note",
      { isWorktree: true, branch: "codex/cache" },
      { count: 1, text: "historical failure hint" },
      "MetaSchedulerForModel=dynamic scheduler note",
      "clean",
    );

    expect(segments.stable).toContain("OutputStyle=");
    expect(segments.stable).toContain("EngineeringStructure=");
    expect(segments.stable).toContain("CommandCapabilitySummary=");
    expect(segments.stable).toContain("shell apply_patch");
    expect(segments.stable).toContain("Edit/MultiEdit/Write");
    expect(segments.dynamic).toContain("RuntimeStatusForModel=");
    expect(segments.dynamic).toContain("EvidenceSummary=");
    expect(segments.dynamic).toContain("SolutionCompleteness=");
    expect(segments.dynamic).toContain("GitStatus=clean");
    expect(segments.dynamic).toContain("MetaSchedulerForModel=dynamic scheduler note");
    expect(context.cache.lastPromptSections?.sections.map((section) => section.name)).toContain("runtime_status");

    for (const token of [
      "RuntimeStatusForModel=",
      "ControlledMemorySummary=",
      "MemoryBoundary=",
      "EvidenceSummary=",
      "SolutionCompleteness=",
      "DeferredToolsReminder=",
      "WorktreeContext=",
      "GitStatus=",
      "AgentCompletionReturnsForMainChain",
      "FailureLearningSummary=",
      "MetaSchedulerForModel=",
    ]) {
      expect(segments.stable).not.toContain(token);
    }
  });

  it("records dynamic prompt section metrics without dropping accepted memory", () => {
    const context = createPromptTestContext({
      memory: {
        ...createPromptTestContext().memory,
        accepted: [
          {
            id: "mem-1",
            scope: "user",
            summary: "User preference: keep progress bar simple",
            source: "test",
            sourceRefs: ["test"],
            risk: "low",
            inferred: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "accepted",
          },
        ],
      },
    });

    const segments = createModelSystemPromptSegments("继续", context, { runtime: "test" });

    expect(segments.dynamic).toContain("User preference: keep progress bar simple");
    expect(context.cache.lastPromptSections).toBeDefined();
    expect(context.cache.lastPromptSections?.sections.map((section) => section.name)).toContain("memory");
    expect(context.cache.lastPromptSections?.largestSection).toBeTruthy();
  });

  it("keeps memory and failure learning outside the cacheable prompt boundary", () => {
    const context = createPromptTestContext({
      memory: {
        ...createPromptTestContext().memory,
        accepted: [
          {
            id: "mem-1",
            scope: "project",
            summary: "Use focused validation after edits",
            source: "test",
            sourceRefs: ["test"],
            risk: "low",
            inferred: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "accepted",
          },
        ],
      },
    });

    const segments = createModelSystemPromptSegments(
      "继续",
      context,
      { runtime: "test" },
      undefined,
      undefined,
      { count: 1, text: '[{"category":"tool_failure","avoid":"retry blindly","severity":"medium","count":1}]' },
    );

    expect(segments.cacheable.map((segment) => segment.content).join("\n")).not.toContain(
      "ControlledMemorySummary=",
    );
    expect(segments.cacheable.map((segment) => segment.content).join("\n")).not.toContain(
      "FailureLearningSummary=",
    );
    expect(segments.volatile.map((segment) => segment.content).join("\n")).toContain(
      "ControlledMemorySummary=",
    );
    expect(segments.volatile.map((segment) => segment.content).join("\n")).toContain(
      "FailureLearningSummary=",
    );
  });

  it("does not inject deferred pre-engine guidance during pre fallback recovery", () => {
    const context = createPromptTestContext({
      preEngineFallbackPreference: {
        projectPath: "F:\\synthetic-project",
        active: true,
        activatedAt: "2026-01-01T00:00:00.000Z",
        reason: "fallback_required",
      },
    });

    const segments = createModelSystemPromptSegments("继续", context, { runtime: "test" });
    const allPromptText = [
      segments.stable,
      segments.dynamic,
      ...segments.cacheable.map((segment) => segment.content),
      ...segments.volatile.map((segment) => segment.content),
    ].join("\n");

    expect(allPromptText).not.toContain("DeferredToolsReminder=");
    expect(allPromptText).not.toContain("PreEngineRepositoryTools=");
    expect(allPromptText).not.toContain("RepositoryAnalysisWorkflow=");
    expect(context.discoveredDeferredToolNames.size).toBe(0);
  });

  it("truncates oversized volatile diagnostics but keeps the section boundary", () => {
    const context = createPromptTestContext();
    const longScheduler = `MetaSchedulerForModel=${"x".repeat(7_000)}`;

    const segments = createModelSystemPromptSegments("继续", context, { runtime: "test" }, undefined, undefined, undefined, longScheduler);

    expect(segments.dynamic).toContain("MetaSchedulerForModel=");
    expect(segments.dynamic).toContain("[meta_scheduler truncated:");
    const meta = context.cache.lastPromptSections?.sections.find((section) => section.name === "meta_scheduler");
    expect(meta?.truncated).toBe(true);
  });

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
    expect(result).not.toContain("内部运行时上下文已从主屏省略");
  });

  it("strips ControlledMemorySummary / MemoryBoundary / EvidenceSummary / CommandCapabilitySummary echoes", () => {
    const text = [
      "解释如下：",
      "ControlledMemorySummary=accepted:0 candidates:0",
      "MemoryBoundary=acceptedOnly; topK=3; autoExtractionRuntime; dedicatedMemoryDir; manualLearnCandidateOnly; noSecretsOrFullDumps",
      "EvidenceSummary=[]",
      "CommandCapabilitySummary=",
      "/help Help: risk=readonly",
    ].join("\n");
    const result = sanitizeMainScreenLeakage(text, "zh-CN");
    expect(result).not.toContain("ControlledMemorySummary");
    expect(result).not.toContain("MemoryBoundary");
    expect(result).not.toContain("EvidenceSummary");
    expect(result).not.toContain("CommandCapabilitySummary");
    expect(result).not.toContain("autoExtractionRuntime");
    expect(result).not.toContain("dedicatedMemoryDir");
  });

  it("strips bare memory boundary tokens even without '='", () => {
    const text =
      "记忆策略：autoExtractionRuntime 生效中；历史 token doNotWriteLongTermMemoryWithoutExplicitMemoryAccept 也可能被复述。";
    const result = sanitizeMainScreenLeakage(text, "zh-CN");
    expect(result).not.toContain("autoExtractionRuntime");
    expect(result).not.toContain("doNotWriteLongTermMemoryWithoutExplicitMemoryAccept");
  });

  it("naturalizes internal tool labels without dropping the conservative conclusion", () => {
    const text =
      "没有查看过项目状态、代码变更或索引状态。\n没有运行过 RunVerification 来验证测试通过或构建成功。";
    const result = sanitizeMainScreenLeakage(text, "zh-CN");
    expect(result).not.toContain("RunVerification");
    expect(result).toContain("没有运行过 验证命令 来验证测试通过或构建成功。");
    expect(result).not.toContain("内部运行时上下文已从主屏省略");
  });

  it("uses an English hint for en-US", () => {
    const text =
      'Status:\nRuntimeStatusForModel={"index":{"status":"ready"}}\nRunVerification was not called.';
    const result = sanitizeMainScreenLeakage(text, "en-US");
    expect(result).not.toContain("RuntimeStatusForModel");
    expect(result).not.toContain("RunVerification");
    expect(result).toContain("verification command was not called");
    expect(result).not.toContain("Internal runtime context was omitted");
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
    expect(result).not.toContain("内部运行时上下文已从主屏省略");
    expect(result).toContain("给用户的人话结论。");
  });

  it("strips Phase 7.13 UserStateDecision internals if a model echoes them", () => {
    const text = [
      'UserStateDecision={"kind":"frustrated","confidence":0.8}',
      'interactionPlan: {"route":"source_fact_first"}',
      'verificationPlan: {"strength":"strengthened"}',
      'notificationPlan: {"quiet":true}',
      'memoryCandidate: {"autoAccept":false}',
      "confidence: 0.8",
      "结论：先看源码事实。",
    ].join("\n");
    const result = sanitizeMainScreenLeakage(text, "zh-CN");

    expect(result).not.toContain("UserStateDecision");
    expect(result).not.toContain("interactionPlan");
    expect(result).not.toContain("verificationPlan");
    expect(result).not.toContain("notificationPlan");
    expect(result).not.toContain("memoryCandidate");
    expect(result).not.toContain("confidence");
    expect(result).not.toContain("内部运行时上下文已从主屏省略");
    expect(result).toContain("结论：先看源码事实。");
  });

  it("strips Phase 7.14 capability internals and raw payload echoes", () => {
    const text = [
      'CapabilityExecutionRequest={"capabilityId":"mock.canvas.export","rawPayload":"secret-sentinel"}',
      'capabilityPlan: {"candidateIds":["mock.canvas.export"]}',
      'CapabilityExecutionResult={"rawPayload":"secret-sentinel","artifactRef":"x"}',
      "raw capability payload: secret-sentinel",
      "结论：已生成 capability 摘要。",
    ].join("\n");
    const result = sanitizeMainScreenLeakage(text, "zh-CN");

    expect(result).not.toContain("CapabilityExecutionRequest");
    expect(result).not.toContain("CapabilityExecutionResult");
    expect(result).not.toContain("capabilityPlan");
    expect(result).not.toContain("rawPayload");
    expect(result).not.toContain("secret-sentinel");
    expect(result).not.toContain("内部运行时上下文已从主屏省略");
    expect(result).toContain("结论：已生成 capability 摘要。");
  });

  it("strips Phase 7.15 app connector internals and raw response echoes", () => {
    const text = [
      'AppConnectorManifest={"appId":"demo.drawing","auth":{"value":"sk-connector-secret"}}',
      'AppConnectorState={"baseUrl":"http://127.0.0.1:47831","capabilityIds":["demo.drawing.paint"]}',
      "raw connector response: sk-connector-secret 60000 raw chars",
      "结论：已连接 Demo Drawing。",
    ].join("\n");
    const result = sanitizeMainScreenLeakage(text, "zh-CN");

    expect(result).not.toContain("AppConnectorManifest");
    expect(result).not.toContain("AppConnectorState");
    expect(result).not.toContain("raw connector response");
    expect(result).not.toContain("sk-connector-secret");
    expect(result).not.toContain("内部运行时上下文已从主屏省略");
    expect(result).toContain("结论：已连接 Demo Drawing。");
  });

  it("does not strip ordinary confidence prose without an internal assignment", () => {
    const text = "我对这个判断的 confidence 还不高，需要先看代码。";
    expect(sanitizeMainScreenLeakage(text, "zh-CN")).toBe(text);
  });

  it("does not falsely strip ordinary prose that merely mentions the word model or memory", () => {
    const text = "你的 model 配置看起来正常，memory 也没问题。";
    expect(sanitizeMainScreenLeakage(text, "zh-CN")).toBe(text);
  });

  it("does not strip ordinary capability prose", () => {
    const text = "这个 capability 只是一个外部能力桥接说明。";
    expect(sanitizeMainScreenLeakage(text, "zh-CN")).toBe(text);
  });
});
