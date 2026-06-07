import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import type { ModelToolCall } from "@linghun/providers";
import { createToolContext } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import type { ArchitectureCard } from "./architecture-runtime.js";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { SEARCH_EXTRA_TOOLS_NAME, createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import { executeModelToolUse } from "./model-tool-runtime.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { decidePermission } from "./tui-permission-runtime.js";
import {
  createCacheState,
  createMcpState,
  createMemoryState,
  createRemoteState,
} from "./tui-state-runtime.js";

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}

describe("tui permission runtime — CCB-aligned modes", () => {
  it("default and auto-review allow readonly/session tools without pending permission", async () => {
    const { context, sessionId } = await createTestContext();
    await writeFile(join(context.projectPath, "README.md"), "# demo\nneedle\n", "utf8");

    for (const mode of ["default", "auto-review"] as const) {
      context.permissionMode = mode;
      for (const [toolName, input] of readonlyAndSessionToolCalls()) {
        const permission = await decidePermission(toolName, input, context, sessionId);
        expect(permission.decision, `${mode} ${toolName}`).toBe("allow");
      }
    }

    expect(context.pendingLocalApproval).toBeUndefined();
    expect(context.permissions.recentDenied).toHaveLength(0);
  });

  it("plan allows readonly/session tools and rejects Write/Edit/MultiEdit/Bash", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "plan";
    await writeFile(join(context.projectPath, "README.md"), "# demo\nneedle\n", "utf8");

    for (const [toolName, input] of readonlyAndSessionToolCalls()) {
      const permission = await decidePermission(toolName, input, context, sessionId);
      expect(permission.decision, `plan ${toolName}`).toBe("allow");
    }

    for (const [toolName, input] of mutatingToolCalls()) {
      const permission = await decidePermission(toolName, input, context, sessionId);
      expect(permission.decision, `plan ${toolName}`).toBe("deny");
    }

    expect(context.pendingLocalApproval).toBeUndefined();
  });

  it("full-access does not repeatedly confirm ordinary safe actions but keeps hard denies", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "full-access";
    await writeFile(join(context.projectPath, "README.md"), "# demo\n", "utf8");

    const read = await decidePermission("Read", { path: "README.md" }, context, sessionId);
    const edit = await decidePermission(
      "Edit",
      { path: "README.md", oldText: "demo", newText: "demo!" },
      context,
      sessionId,
    );
    const secret = await decidePermission(
      "Write",
      { path: ".env", content: "TOKEN=raw" },
      context,
      sessionId,
    );

    expect(read.decision).toBe("allow");
    expect(edit.decision).toBe("allow");
    expect(secret.decision).toBe("deny");
    expect(context.pendingLocalApproval).toBeUndefined();
  });

  it("architecture drift does not intercept readonly/session/discovery tools", async () => {
    const { context, sessionId } = await createTestContext();
    context.currentArchitectureCard = architectureCard();
    await writeFile(join(context.projectPath, "README.md"), "# demo\nneedle\n", "utf8");
    await mkdir(join(context.projectPath, "src"), { recursive: true });
    await writeFile(join(context.projectPath, "src", "a.ts"), "export const a = 1;\n", "utf8");
    const output = new MemoryOutput();

    for (const [toolName, input] of readonlyAndSessionToolCalls()) {
      const result = await executeModelToolUse(call(toolName, input), context, sessionId, output);
      expect(result.pendingApproval, toolName).not.toBe(true);
      expect(context.pendingLocalApproval, toolName).toBeUndefined();
    }

    const discovery = await executeModelToolUse(
      call(SEARCH_EXTRA_TOOLS_NAME, { query: "index", limit: 2 }),
      context,
      sessionId,
      output,
    );
    expect(discovery.tool).toBe(SEARCH_EXTRA_TOOLS_NAME);
    expect(discovery.pendingApproval).not.toBe(true);
    expect(context.pendingLocalApproval).toBeUndefined();
  });

  it("architecture drift still confirms mutating drift before execution", async () => {
    const { context, sessionId } = await createTestContext();
    context.currentArchitectureCard = architectureCard();
    const output = new MemoryOutput();

    const result = await executeModelToolUse(
      call("Edit", {
        path: "packages/other/src/new-runtime.ts",
        oldText: "a",
        newText: "b",
      }),
      context,
      sessionId,
      output,
    );

    expect(result.pendingApproval).toBe(true);
    expect(context.pendingLocalApproval).toMatchObject({
      kind: "architecture_drift",
      toolName: "Edit",
    });
  });
});

function readonlyAndSessionToolCalls(): Array<[
  "Read" | "Grep" | "Glob" | "Diff" | "Todo",
  unknown,
]> {
  return [
    ["Read", { path: "README.md" }],
    ["Grep", { pattern: "needle", path: "." }],
    ["Glob", { pattern: "**/*.ts", path: "." }],
    ["Diff", {}],
    ["Todo", { action: "list" }],
  ];
}

function mutatingToolCalls(): Array<["Write" | "Edit" | "MultiEdit" | "Bash", unknown]> {
  return [
    ["Write", { path: "note.md", content: "x" }],
    ["Edit", { path: "note.md", oldText: "x", newText: "y" }],
    ["MultiEdit", { path: "note.md", edits: [{ oldText: "x", newText: "y" }] }],
    ["Bash", { command: "echo hi" }],
  ];
}

function call(name: string, input: unknown): ModelToolCall {
  return { id: `tc-${name}-${Math.random()}`, name, input };
}

function architectureCard(): ArchitectureCard {
  return {
    target: "只处理 packages/tui/src/model-tool-runtime.ts 的权限 drift 行为",
    projectFacts: ["source: packages/tui/src/model-tool-runtime.ts is in scope"],
    recommendedApproach: "最小修改权限确认边界。",
    rejectedApproaches: ["不新增权限模式。"],
    stagedBreakdown: ["补 focused tests。"],
    risks: ["只读工具不得进入权限确认。"],
    verification: ["运行 focused tests。"],
    nonGoals: [
      "不改变 default/auto-review/plan/full-access 四权限模式。",
      "不新增未确认的依赖、配置、agent、DB 或长期 memory。",
    ],
  };
}

async function createTestContext(): Promise<{ context: TuiContext; sessionId: string }> {
  const projectPath = await mkdtemp(join(tmpdir(), "linghun-permission-runtime-"));
  const store = new SessionStore({ projectPath, sessionRootDir: join(projectPath, ".sessions") });
  const session = await store.create({ model: "deepseek-chat" });
  const context = {
    store,
    sessionId: session.id,
    model: "deepseek-chat",
    permissionMode: "default",
    projectPath,
    tools: createToolContext(projectPath),
    permissions: { rules: [], recentDenied: [] },
    language: "zh-CN",
    config: defaultConfig,
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: createCacheState(projectPath, "deepseek-chat", [], defaultConfig),
    mcp: createMcpState(defaultConfig),
    index: createIndexState(defaultConfig),
    memory: await createMemoryState(defaultConfig, projectPath),
    failureLearning: createFailureLearningState(projectPath, defaultConfig),
    skills: { enabled: false, skills: [], errors: [] },
    workflows: { templates: [], activeRun: undefined, history: [] },
    agentRegistry: { agents: [], errors: [] },
    workflowRegistry: { workflows: [], errors: [] },
    hooks: { enabled: false, hooks: [], errors: [] },
    plugins: { enabled: false, plugins: [], errors: [] },
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
    discoveredDeferredToolNames: new Set<string>(),
  } as unknown as TuiContext;
  return { context, sessionId: session.id };
}
