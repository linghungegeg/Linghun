import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPostCompactRestoreMessage,
  buildPostCompactRestorePayload,
  formatPostCompactRestorePayload,
} from "./compact-restore-runtime.js";
import { createEmptyMemoryTombstoneIndex } from "./memory-tombstone-runtime.js";
import type { TuiContext } from "./index.js";

function makeContext(projectPath: string, overrides: Partial<TuiContext> = {}): TuiContext {
  return {
    projectPath,
    recentlyMentionedFiles: [],
    tools: { changedFiles: [], todos: [], workspaceRoot: projectPath },
    cache: {},
    activePlan: undefined,
    agents: [],
    workflows: {},
    memory: {
      projectDir: join(projectPath, ".linghun", "memory", "project"),
      userDir: join(projectPath, ".linghun", "memory", "user"),
      sessionDir: join(projectPath, ".linghun", "memory", "session"),
      projectRulesPath: join(projectPath, "LINGHUN.md"),
      projectRulesExists: false,
      projectRulesSummary: "missing",
      candidates: [],
      accepted: [],
      rejected: [],
      disabled: [],
      retired: [],
      learningMode: "off",
      tombstones: createEmptyMemoryTombstoneIndex(),
    },
    ...overrides,
  } as TuiContext;
}

describe("post compact restore runtime", () => {
  it("restores recent workspace file content with plan and active runtime status", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-compact-restore-"));
    await mkdir(join(project, "src"));
    await writeFile(
      join(project, "src", "current.ts"),
      'export const current = {"requestTurnId":"source-turn"};\n',
      "utf8",
    );

    const context = makeContext(project, {
      recentlyMentionedFiles: ["src/current.ts"],
      tools: { changedFiles: ["src/current.ts"], todos: [], workspaceRoot: project },
      activePlan: {
        id: "plan-1",
        title: "Finish restore requestTurnId=turn-plan-42",
        options: [{ id: "a", title: "Main", steps: ["Read file ownerId=owner-plan-42"], risks: ["none"] }],
      },
      agents: [
        {
          id: "agent-1",
          type: "worker",
          role: "executor",
          provider: "test",
          task: "continue restore work ownerId=owner-agent-42",
          model: "test-model",
          permissionMode: "auto-review",
          status: "running",
          transcriptPath: "agent.log",
          transcriptSessionId: "agent-session",
          mailbox: [],
          summary: "running worker",
          contextSummary: "restore context",
          cost: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedCny: 0,
          },
          startedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      workflows: {
        enabled: true,
        templates: [],
        disabledIds: [],
        activeRun: {
          id: "wf-1",
          goal: "ship restore fallbackUsed=true",
          planId: "plan-wf",
          status: "running",
          steps: [],
          startedAt: "2026-01-01T00:00:00.000Z",
          result: "partial",
        },
      },
    });

    const message = await buildPostCompactRestoreMessage(context);

    expect(message?.role).toBe("user");
    expect(message?.content).toContain("Post-compact restored context");
    expect(message?.content).toContain("file src/current.ts");
    expect(message?.content).toContain('export const current = {"requestTurnId":"source-turn"};');
    expect(message?.content).toContain("PlanProposal: Finish restore");
    expect(message?.content).toContain("agent: running; task continue restore work");
    expect(message?.content).toContain("workflow: running; goal ship restore");
    expect(message?.content).not.toContain("plan-1");
    expect(message?.content).not.toContain("agent-1");
    expect(message?.content).not.toContain("wf-1");
    expect(message?.content).not.toContain("turn-plan-42");
    expect(message?.content).not.toContain("owner-plan-42");
    expect(message?.content).not.toContain("owner-agent-42");
    expect(message?.content).not.toContain("fallbackUsed=true");
  });

  it("skips missing and out-of-workspace files without failing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-compact-restore-"));
    const context = makeContext(project, {
      recentlyMentionedFiles: ["missing.ts", "../outside.ts"],
      tools: { changedFiles: [], todos: [], workspaceRoot: project },
    });

    const payload = await buildPostCompactRestorePayload(context);

    expect(payload.files).toEqual([]);
    expect(formatPostCompactRestorePayload(payload)).toBeUndefined();
  });

  it("truncates restored files within per-file budget", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-compact-restore-"));
    await mkdir(join(project, "src"));
    await writeFile(join(project, "src", "large.ts"), `START${"x".repeat(7_000)}END`, "utf8");

    const payload = await buildPostCompactRestorePayload(
      makeContext(project, {
        recentlyMentionedFiles: ["src/large.ts"],
        tools: { changedFiles: [], todos: [], workspaceRoot: project },
      }),
    );

    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]?.truncated).toBe(true);
    expect(payload.files[0]?.content.length).toBeLessThanOrEqual(5_000);
  });

  it("keeps restore bytes stable until a new compact boundary", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-compact-restore-"));
    await mkdir(join(project, "src"));
    const file = join(project, "src", "current.ts");
    await writeFile(file, "export const current = 1;\n", "utf8");
    const context = makeContext(project, {
      recentlyMentionedFiles: ["src/current.ts"],
      tools: { changedFiles: ["src/current.ts"], todos: [], workspaceRoot: project },
    });
    context.cache.deepCompact = { id: "deep-1" } as never;

    const first = await buildPostCompactRestoreMessage(context);
    await writeFile(file, "export const current = 2;\n", "utf8");
    const second = await buildPostCompactRestoreMessage(context);

    expect(second).toEqual(first);
    expect(second?.content).toContain("current = 1");

    context.cache.compactProjection = { boundaryId: "projection-1" } as never;
    const afterProjectionCompact = await buildPostCompactRestoreMessage(context);
    expect(afterProjectionCompact?.content).toContain("current = 2");

    await writeFile(file, "export const current = 3;\n", "utf8");
    context.cache.deepCompact = { id: "deep-2" } as never;
    const afterCompact = await buildPostCompactRestoreMessage(context);
    expect(afterCompact?.content).toContain("current = 3");
  });

  it("does not inject accepted memory through the restore payload", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-compact-restore-"));
    const context = makeContext(project);
    context.memory.accepted = [{
      id: "mem-user-1",
      scope: "user",
      status: "accepted",
      taxonomy: "user",
      summary: "User prefers concise summaries",
      source: "manual",
      sourceRefs: [],
      risk: "low",
      inferred: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    }];

    const payload = await buildPostCompactRestorePayload(context);
    expect(payload).not.toHaveProperty("userConstraints");
    expect(formatPostCompactRestorePayload(payload)).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("User prefers concise summaries");
  });
});
