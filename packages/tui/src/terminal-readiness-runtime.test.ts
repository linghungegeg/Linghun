import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { createToolContext } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import {
  createCacheState,
  createFailureLearningState,
  createHookState,
  createIndexState,
  createMcpState,
  createMemoryState,
  createPluginState,
  createRemoteState,
  createSkillState,
  createSolutionCompletenessStatus,
  createWorkflowState,
  type TuiContext,
} from "./index.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import { createTerminalReadinessView } from "./terminal-readiness-runtime.js";
import type { BackgroundTaskState } from "./tui-data-types.js";

function task(overrides: Partial<BackgroundTaskState>): BackgroundTaskState {
  const now = new Date().toISOString();
  return {
    id: "task",
    kind: "job",
    title: "Task",
    status: "running",
    startedAt: now,
    updatedAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    userVisibleSummary: "task summary",
    ...overrides,
  };
}

describe("terminal readiness runtime", () => {
  it("keeps stale and terminal tasks out of ordinary background total/cost labels", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-readiness-background-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(join(project, "package.json"), JSON.stringify({ packageManager: "pnpm" }));
    const store = new SessionStore({ sessionRootDir: project, projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context: TuiContext = {
      store,
      sessionId: session.id,
      model: session.model,
      permissionMode: session.permissionMode,
      projectPath: project,
      tools: createToolContext(project),
      permissions: { rules: [], recentDenied: [] },
      language: "en-US",
      config: defaultConfig,
      backgroundTasks: [
        task({ id: "job-stale", status: "stale", userVisibleSummary: "stale job" }),
        task({ id: "job-cancelled", status: "cancelled", userVisibleSummary: "cancelled job" }),
        task({ id: "job-done", status: "completed", userVisibleSummary: "done job" }),
      ],
      checkpoints: [],
      evidence: [],
      cache: createCacheState(project, session.model, [], defaultConfig),
      mcp: createMcpState(defaultConfig),
      index: createIndexState(defaultConfig),
      memory: await createMemoryState(defaultConfig, project),
      failureLearning: createFailureLearningState(project, defaultConfig),
      skills: await createSkillState(defaultConfig, project),
      workflows: createWorkflowState(defaultConfig),
      agentRegistry: { agents: [], errors: [] },
      workflowRegistry: { workflows: [], errors: [] },
      hooks: await createHookState(defaultConfig, project),
      plugins: await createPluginState(defaultConfig, project),
      remote: createRemoteState(defaultConfig),
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
      backgroundAbortControllers: new Map(),
      discoveredDeferredToolNames: new Set(),
    };

    const view = createTerminalReadinessView(context);

    expect(view.background).toEqual({ total: 0, running: 0, blocked: 1 });
    expect(view.costPreview.labels).not.toContain("background-visible");
    expect(view.costPreview.level).toBe("light");
    expect(view.problems.map((problem) => problem.summary)).toEqual(
      expect.arrayContaining([expect.stringContaining("job stale")]),
    );
    expect(view.problems.map((problem) => problem.summary).join("\n")).not.toContain(
      "cancelled job",
    );
    expect(view.problems.map((problem) => problem.summary).join("\n")).not.toContain("done job");

    context.backgroundTasks.push(
      task({ id: "job-blocked", status: "blocked", userVisibleSummary: "blocked job" }),
    );
    const blockedView = createTerminalReadinessView(context);

    expect(blockedView.background).toEqual({ total: 1, running: 0, blocked: 2 });
    expect(blockedView.costPreview.labels).toContain("background-visible");
    expect(blockedView.problems.map((problem) => problem.summary)).toEqual(
      expect.arrayContaining([expect.stringContaining("job blocked")]),
    );
  });
});
