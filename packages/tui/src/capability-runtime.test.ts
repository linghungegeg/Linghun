import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, getSessionRootDir } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { createToolContext } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import {
  executeCapability,
  findCapability,
  formatCapabilityDoctor,
  formatCapabilityList,
  formatCapabilityResult,
  listCapabilities,
  registerCapability,
  resolveCapabilityConnection,
  resolveCapabilityDispatchRuntimePolicy,
} from "./capability-runtime.js";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import type { TuiContext } from "./tui-context-runtime.js";
import {
  createCacheState,
  createHookState,
  createMcpState,
  createMemoryState,
  createPluginState,
  createRemoteState,
  createSkillState,
  createWorkflowState,
} from "./tui-state-runtime.js";

describe("Capability Runtime MVP", () => {
  it("registers, lists, and finds capabilities", () => {
    registerCapability({
      id: "test.dynamic.read",
      appId: "test.dynamic",
      title: "Dynamic Read",
      description: "Dynamic test capability.",
      category: "test",
      intents: ["test"],
      keywords: ["test"],
      transport: "mock",
      auth: "none",
      permission: "read",
      riskLevel: "low",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      supportsRollback: false,
      supportsPreview: false,
    });

    expect(findCapability("test.dynamic.read")?.title).toBe("Dynamic Read");
    expect(listCapabilities().map((item) => item.id)).toContain("test.dynamic.read");
  });

  it("executes mock read capability and records evidence summary", async () => {
    const context = await createCapabilityTestContext("default");
    const result = await executeCapability(
      { capabilityId: "mock.echo.read", input: { text: "hello" }, source: "slash" },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("hello");
    expect(result.evidenceId).toBeTruthy();
    expect(context.evidence[0]?.summary).toContain("capability succeeded mock.echo.read");
    expect(context.evidence[0]?.supportsClaims).toContain("capability_success");
    expect(context.evidence[0]?.supportsClaims).toContain("not_verification_pass");
  });

  it("records succeeded capability evidence without verification pass support", async () => {
    const context = await createCapabilityTestContext("full-access");
    const result = await executeCapability(
      { capabilityId: "mock.canvas.create", input: { title: "Draft" }, source: "slash" },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Canvas created");
    expect(result.evidenceId).toBeTruthy();
    const evidence = context.evidence.find((item) => item.id === result.evidenceId);
    expect(evidence?.summary).toContain("capability succeeded mock.canvas.create");
    expect(evidence?.supportsClaims).toContain("capability_execution");
    expect(evidence?.supportsClaims).toContain("capability_success");
    expect(evidence?.supportsClaims).toContain("not_verification_pass");
    expect(evidence?.supportsClaims).not.toContain("capability_failure");
    expect(evidence?.supportsClaims).not.toContain("verification_passed");
  });

  it("does not bypass permission for external_app/write capability", async () => {
    const context = await createCapabilityTestContext("plan");
    const result = await executeCapability(
      { capabilityId: "mock.canvas.create", input: { title: "Blocked" }, source: "slash" },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Permission denied");
    expect(context.permissions.recentDenied.some((item) => item.toolName === "Write")).toBe(true);
  });

  it("allows external_app/write capability in full-access mode through the same permission path", async () => {
    const context = await createCapabilityTestContext("full-access");
    const result = await executeCapability(
      { capabilityId: "mock.canvas.create", input: { title: "Allowed" }, source: "slash" },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.metadata.permission).toBe("external_app");
    expect(context.permissions.recentDenied).toEqual([]);
  });

  it("stores large mock output as artifact ref without returning raw payload", async () => {
    const context = await createCapabilityTestContext("full-access");
    const result = await executeCapability(
      { capabilityId: "mock.canvas.export", input: { format: "png" }, source: "slash" },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("artifact");
    expect(result.summary).not.toContain("x".repeat(100));
    expect(result.artifactRef).toBeTruthy();
    const artifactPath = result.artifactRef?.startsWith("mock-artifact:")
      ? context.evidence.find((item) => item.supportsClaims.includes("tool_result_budget"))
          ?.fullOutputPath
      : result.artifactRef;
    expect(artifactPath).toBeTruthy();
    const artifact = await readFile(artifactPath ?? "", "utf8");
    expect(artifact).toContain("mock canvas export");
  });

  it("keeps large capability payload out of transcript events while preserving an artifact ref", async () => {
    const context = await createCapabilityTestContext("full-access");
    const result = await executeCapability(
      { capabilityId: "mock.canvas.export", input: { format: "png" }, source: "slash" },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.artifactRef).toBeTruthy();
    expect(context.sessionId).toBeTruthy();
    const transcript = (await context.store.resume(context.sessionId ?? "")).transcript;
    const raw = JSON.stringify(transcript);
    expect(raw).toContain("tool_result_budget_persisted");
    expect(raw).toContain("artifact=");
    expect(raw).toMatch(/sha256=[a-f0-9]{64}/u);
    expect(raw).not.toContain("x".repeat(30_000));
    const artifactPath = context.evidence.find((item) =>
      item.supportsClaims.includes("tool_result_budget"),
    )?.fullOutputPath;
    expect(artifactPath).toBeTruthy();
    await expect(readFile(artifactPath ?? "", "utf8")).resolves.toContain("mock canvas export");
  });

  it("resolves transports on demand and reports unsupported connectors in doctor", () => {
    registerCapability({
      id: "test.http.pending",
      appId: "test.http",
      title: "HTTP Pending",
      description: "Reserved HTTP capability.",
      category: "test",
      intents: ["http"],
      keywords: ["http"],
      transport: "http",
      auth: "api_key",
      permission: "network",
      riskLevel: "medium",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      supportsRollback: false,
      supportsPreview: false,
    });
    const definition = findCapability("test.http.pending");
    expect(definition).toBeTruthy();
    if (!definition) throw new Error("test.http.pending missing");
    expect(resolveCapabilityConnection(definition).status).toBe("needs_configuration");
    const doctor = formatCapabilityDoctor("zh-CN");
    expect(doctor).toContain("test.http.pending");
    expect(doctor).toContain("needs_configuration");
    expect(doctor).toContain("availability=reserved/needs_configuration");
    expect(doctor).toContain("availability=mock/demo");
    expect(doctor).toContain("not a real external capability");
  });

  it("sanitizes capability metadata in list, doctor, and result details", () => {
    registerCapability({
      id: "test.secret.read",
      appId: "test.secret",
      title: "Secret sk-title-token",
      description: "Authorization: Bearer raw-display-token api_key=raw-key",
      category: "test",
      intents: ["secret"],
      keywords: ["secret"],
      transport: "mock",
      auth: "none",
      permission: "read",
      riskLevel: "low",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      supportsRollback: false,
      supportsPreview: false,
    });

    const list = formatCapabilityList("zh-CN");
    const doctor = formatCapabilityDoctor("zh-CN");
    const formatted = formatCapabilityResult({
      ok: true,
      capabilityId: "test.secret.read",
      summary: "summary sk-result-secret",
      details: "details token=raw-token Authorization: Bearer raw-auth",
      metadata: {
        transport: "mock",
        auth: "none",
        permission: "read",
        riskLevel: "low",
        connectionStatus: "connected",
      },
    });

    const visible = [list, doctor, ...formatted.summary, formatted.detailsText].join("\n");
    expect(visible).toContain("sk-***");
    expect(visible).toContain("Authorization: ***");
    expect(visible).not.toContain("sk-title-token");
    expect(visible).not.toContain("raw-display-token");
    expect(visible).not.toContain("raw-result-secret");
    expect(visible).not.toContain("raw-auth");
  });

  it("maps meta scheduler capability stop/ask/degrade into runtime policy", () => {
    const baseAction = {
      reason: "slow down",
      shouldAsk: false,
      shouldDegrade: false,
      shouldStop: false,
    };
    const lowRiskRead = { permission: "read" as const, riskLevel: "low" as const };

    expect(resolveCapabilityDispatchRuntimePolicy(baseAction, lowRiskRead)).toEqual({ action: "run" });
    expect(
      resolveCapabilityDispatchRuntimePolicy({ ...baseAction, shouldAsk: true }, lowRiskRead),
    ).toEqual({ action: "block", reason: "slow down", blockedBy: "ask" });
    expect(
      resolveCapabilityDispatchRuntimePolicy({ ...baseAction, shouldStop: true }, lowRiskRead),
    ).toEqual({ action: "block", reason: "slow down", blockedBy: "stop" });
    expect(
      resolveCapabilityDispatchRuntimePolicy({ ...baseAction, shouldDegrade: true }, lowRiskRead),
    ).toEqual({ action: "degrade-readonly", reason: "slow down" });
    expect(
      resolveCapabilityDispatchRuntimePolicy(
        { ...baseAction, shouldDegrade: true },
        { permission: "external_app", riskLevel: "high" },
      ),
    ).toEqual({ action: "block", reason: "slow down", blockedBy: "unsafe-degrade" });
  });

  it("allows only low-risk read capability execution under degrade", async () => {
    const context = await createCapabilityTestContext("default");
    context.lastMetaSchedulerDecision = {
      orchestrationPlan: {
        steps: [
          {
            id: "capability-dispatch",
            executor: "capability-runtime",
            mode: "degrade",
            reason: "reduce side effects",
          },
        ],
      },
    } as TuiContext["lastMetaSchedulerDecision"];

    const result = await executeCapability(
      { capabilityId: "mock.echo.read", input: { text: "readonly" }, source: "slash" },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("readonly");
    expect(context.metaOrchestration?.events.some((event) => event.status === "degraded")).toBe(
      true,
    );
  });

  it("blocks unsafe capability execution under degrade without recording success evidence", async () => {
    const context = await createCapabilityTestContext("full-access");
    context.lastMetaSchedulerDecision = {
      orchestrationPlan: {
        steps: [
          {
            id: "capability-dispatch",
            executor: "capability-runtime",
            mode: "degrade",
            reason: "reduce side effects",
          },
        ],
      },
    } as TuiContext["lastMetaSchedulerDecision"];

    const result = await executeCapability(
      { capabilityId: "mock.canvas.create", input: { title: "Blocked" }, source: "slash" },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("degraded execution is only allowed");
    expect(context.evidence).toEqual([]);
    expect(
      context.metaOrchestration?.events.some(
        (event) => event.status === "blocked" && event.summary.includes("unsafe capability degrade"),
      ),
    ).toBe(true);
  });

  it("blocks capability execution when meta scheduler requests stop", async () => {
    const context = await createCapabilityTestContext("full-access");
    context.lastMetaSchedulerDecision = {
      orchestrationPlan: {
        steps: [
          {
            id: "capability-dispatch",
            executor: "capability-runtime",
            mode: "stop",
            reason: "capability dispatch disabled",
          },
        ],
      },
    } as TuiContext["lastMetaSchedulerDecision"];

    const result = await executeCapability(
      { capabilityId: "mock.canvas.create", input: { title: "Blocked" }, source: "slash" },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Capability dispatch blocked by meta scheduler");
    expect(context.evidence).toEqual([]);
    expect(context.metaOrchestration?.events.some((event) => event.status === "blocked")).toBe(true);
  });
});

async function createCapabilityTestContext(
  permissionMode: TuiContext["permissionMode"],
): Promise<TuiContext> {
  const project = await mkdtemp(join(tmpdir(), "linghun-capability-runtime-"));
  const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
  const session = await store.create({ model: "deepseek-chat" });
  const config = defaultConfig;
  return {
    store,
    sessionId: session.id,
    model: session.model,
    permissionMode,
    projectPath: project,
    tools: createToolContext(project),
    permissions: { rules: [], recentDenied: [] },
    language: "zh-CN",
    config,
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: createCacheState(project, session.model, [], config),
    mcp: createMcpState(config),
    index: createIndexState(config),
    memory: await createMemoryState(config, project),
    failureLearning: createFailureLearningState(project),
    skills: await createSkillState(config, project),
    workflows: createWorkflowState(config),
    agentRegistry: { agents: [], errors: [] },
    workflowRegistry: { workflows: [], errors: [] },
    hooks: await createHookState(config, project),
    plugins: await createPluginState(config, project),
    remote: createRemoteState(config),
    agents: [],
    roleUsage: [],
    routeDecisions: [],
    roleHandoffs: [],
    visionObservations: [],
    imageResults: [],
    interrupt: { type: "idle" },
    recentlyMentionedFiles: [],
    providerBreaker: createProviderCircuitBreakerState(),
    solutionCompleteness: createSolutionCompletenessStatus(),
    discoveredDeferredToolNames: new Set<string>(),
  };
}
