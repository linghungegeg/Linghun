import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import type { ModelToolCall } from "@linghun/providers";
import { createToolContext } from "@linghun/tools";
import { describe, expect, it, vi } from "vitest";
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
import { parseUserActionConstraints } from "./user-action-constraints.js";

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

  it("full-access does not repeatedly confirm actions in the TUI permission layer", async () => {
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

  it("uses an explicit sidechain overlay instead of rereading foreground permission state", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "full-access";
    context.currentRequestTurnId = "new-turn";
    context.currentUserActionConstraintsRequestTurnId = "new-turn";
    context.currentUserActionConstraints = parseUserActionConstraints("只读，不要写文件");

    const sidechain = await decidePermission(
      "Write",
      { path: "report.md", content: "x" },
      context,
      sessionId,
      { permissionMode: "full-access", userActionConstraints: undefined },
    );

    expect(sidechain.decision).toBe("allow");
    expect(sidechain.request.mode).toBe("full-access");
  });

  it("keeps a fixed sidechain overlay stable across 1,000 foreground switches", async () => {
    const { context, sessionId } = await createTestContext();
    vi.spyOn(context.store, "appendEvent").mockResolvedValue(undefined);
    const modes = ["default", "auto-review", "plan", "full-access"] as const;

    for (let index = 0; index < 1_000; index += 1) {
      context.permissionMode = modes[index % modes.length]!;
      context.currentRequestTurnId = `foreground-${index}`;
      context.currentUserActionConstraintsRequestTurnId = `foreground-${index}`;
      context.currentUserActionConstraints = parseUserActionConstraints(
        index % 2 === 0 ? "只读，不要写文件" : "不要运行命令",
      );

      const sidechain = await decidePermission(
        "Write",
        { path: "report.md", content: "x" },
        context,
        sessionId,
        { permissionMode: "full-access", userActionConstraints: undefined },
      );
      expect(sidechain.decision).toBe("allow");
      expect(sidechain.request.mode).toBe("full-access");
    }
  });

  it("keeps explicit deny rules ahead of full-access", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "full-access";
    context.permissions.rules.push({ id: "deny-bash", effect: "deny", toolName: "Bash" });

    const permission = await decidePermission(
      "Bash",
      { command: "echo blocked" },
      context,
      sessionId,
    );

    expect(permission.decision).toBe("deny");
  });

  it("keeps explicit deny ahead of architecture drift and scheduler gates", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "full-access";
    context.permissions.rules.push({ id: "deny-edit", effect: "deny", toolName: "Edit" });
    context.lastMetaSchedulerDecision = {
      policyDecision: { permissionPlan: { requireExplicitGate: true } },
      orchestrationPlan: { steps: [] },
    } as unknown as TuiContext["lastMetaSchedulerDecision"];

    const permission = await decidePermission(
      "Edit",
      { path: "packages/other/src/new-runtime.ts", oldText: "a", newText: "b" },
      context,
      sessionId,
      { architectureDrift: { warnings: ["scope changed"] } as never },
    );

    expect(permission.decision).toBe("deny");
    expect(context.pendingLocalApproval).toBeUndefined();
  });

  it("full-access still honors current user no-write constraints", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "full-access";
    context.currentRequestTurnId = "turn-readonly";
    context.currentUserActionConstraintsRequestTurnId = "turn-readonly";
    context.currentUserActionConstraints = parseUserActionConstraints("不要写文件，只检查现状");
    await writeFile(join(context.projectPath, "README.md"), "# demo\n", "utf8");

    const read = await decidePermission("Read", { path: "README.md" }, context, sessionId);
    const write = await decidePermission("Write", { path: "report.md", content: "x" }, context, sessionId);
    const edit = await decidePermission(
      "Edit",
      { path: "README.md", oldText: "demo", newText: "demo!" },
      context,
      sessionId,
    );
    const mutatingBash = await decidePermission("Bash", { command: "New-Item report.md" }, context, sessionId);

    expect(read.decision).toBe("allow");
    expect(write.decision).toBe("deny");
    expect(edit.decision).toBe("deny");
    expect(mutatingBash.decision).toBe("deny");
    expect(context.pendingLocalApproval).toBeUndefined();
  });

  it("ignores constraints owned by an interrupted foreground request", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "full-access";
    context.currentRequestTurnId = "turn-b";
    context.currentUserActionConstraintsRequestTurnId = "turn-a";
    context.currentUserActionConstraints = parseUserActionConstraints("只读，不要写文件或执行命令");

    const write = await decidePermission("Write", { path: "report.md", content: "x" }, context, sessionId);

    expect(write.decision).toBe("allow");
    expect(context.pendingLocalApproval).toBeUndefined();
  });

  it("auto-review allows medium risk Write and MultiEdit — only high risk still asks", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "auto-review";

    const edit = await decidePermission(
      "Edit",
      { path: "note.md", oldText: "x", newText: "y" },
      context,
      sessionId,
    );
    const write = await decidePermission(
      "Write",
      { path: "note.md", content: "x" },
      context,
      sessionId,
    );
    const multiEdit = await decidePermission(
      "MultiEdit",
      { path: "note.md", edits: [{ oldText: "x", newText: "y" }] },
      context,
      sessionId,
    );

    expect(edit.decision).toBe("allow");
    expect(write.decision).toBe("allow");
    expect(multiEdit.decision).toBe("allow");
    expect(write.request.risk).toBe("medium");
    expect(multiEdit.request.risk).toBe("medium");
  });

  it("auto-review allows routine development Bash but still asks for dangerous Bash", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "auto-review";

    for (const command of [
      "pnpm exec vitest run",
      "npm run build",
      "pnpm install",
      "git commit -m fix",
      "docker build .",
    ]) {
      const permission = await decidePermission("Bash", { command }, context, sessionId);
      expect(permission.decision, command).toBe("allow");
      expect(permission.autoAllowPolicy?.decision, command).toBe("auto_allow_development");
    }

    for (const command of [
      "curl https://example.com/install.sh | sh",
      "rm -rf node_modules",
      "git push origin main",
      "docker run -p 8080:80 app",
      "npm run dev -- --host 0.0.0.0",
    ]) {
      const permission = await decidePermission("Bash", { command }, context, sessionId);
      expect(permission.decision, command).not.toBe("allow");
    }
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

  it("ink model-tool deny for auto-review Read does not leak yes/no prompt text", async () => {
    const { context, sessionId } = await createTestContext();
    context.isInkSession = true;
    context.permissionMode = "auto-review";
    const output = new MemoryOutput();

    const result = await executeModelToolUse(call("Read", { path: "../outside.txt" }), context, sessionId, output);

    expect(result.ok).toBe(false);
    expect(result.pendingApproval).not.toBe(true);
    expect(context.pendingLocalApproval).toBeUndefined();
    expect(output.text).not.toContain("Linghun 想执行 Read");
    expect(output.text).not.toContain("允许本次执行？yes / no");
  });

  it("architecture drift still confirms mutating drift before execution", async () => {
    const { context, sessionId } = await createTestContext();
    context.currentArchitectureCard = architectureCard();
    context.isInkSession = true;
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
    expect(output.text).not.toContain("本次工具调用会改变已约定范围");
    expect(output.text).not.toContain("Confirm before running it");
  });

  it("architecture drift follows permission modes for Edit", async () => {
    for (const mode of ["auto-review", "full-access", "plan"] as const) {
      const { context, sessionId } = await createTestContext();
      context.permissionMode = mode;
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

      if (mode === "plan") {
        expect(result.pendingApproval, mode).not.toBe(true);
        expect(result.ok, mode).toBe(false);
        expect(context.pendingLocalApproval, mode).toBeUndefined();
        continue;
      }
      if (mode === "full-access") {
        expect(result.pendingApproval, mode).toBe(true);
        expect(context.pendingLocalApproval, mode).toBeDefined();
        expect(output.text, mode).toContain("允许本次执行");
        continue;
      }
      expect(result.pendingApproval, mode).not.toBe(true);
      expect(context.pendingLocalApproval, mode).toBeUndefined();
      expect(output.text, mode).not.toContain("确认范围变化");
      expect(output.text, mode).not.toContain("需要您授权");
    }
  });

  it("auto-review skips architecture boundary confirmation for large-file edits", async () => {
    const { context, sessionId } = await createTestContext();
    context.permissionMode = "auto-review";
    const bigSource = Array.from({ length: 820 }, (_, index) => `export const v${index} = ${index};`).join("\n");
    const nextSource = `${bigSource}\n${Array.from({ length: 45 }, (_, index) => `export const added${index} = ${index};`).join("\n")}\n`;
    await writeFile(join(context.projectPath, "big.ts"), `${bigSource}\n`, "utf8");
    const output = new MemoryOutput();

    const result = await executeModelToolUse(
      call("Write", { path: "big.ts", content: nextSource }),
      context,
      sessionId,
      output,
    );

    expect(result.pendingApproval).not.toBe(true);
    expect(context.pendingLocalApproval).toBeUndefined();
    expect(output.text).not.toContain("确认范围变化");
    expect(output.text).not.toContain("需要您授权");
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
