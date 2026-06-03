import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ToolResultBudgetState,
  applyToolResultBudgetToMessages,
} from "./tool-result-budget.js";

describe("tool_result budget", () => {
  it("persists a single oversized Read tool_result and preserves tool role pairing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    const large = `READ_BIG_START\n${"x".repeat(55_000)}\nREAD_BIG_END`;
    const result = await applyToolResultBudgetToMessages(
      [
        { role: "user", content: "read" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-read", name: "Read", input: { path: "large.txt" } }],
        },
        { role: "tool", tool_call_id: "call-read", content: large },
      ],
      { projectPath: project, sessionId: "session-a" },
    );

    const tool = result.messages.find((message) => message.role === "tool");
    expect(tool?.role === "tool" ? tool.tool_call_id : undefined).toBe("call-read");
    expect(tool?.role === "tool" ? tool.content : "").toContain("<persisted-tool-result>");
    expect(tool?.role === "tool" ? tool.content : "").toContain("artifactPath:");
    expect(tool?.role === "tool" ? tool.content : "").toContain("preview:");
    expect(tool?.role === "tool" ? tool.content : "").toContain("READ_BIG_START");
    expect(tool?.role === "tool" ? tool.content : "").not.toContain("READ_BIG_END");
    expect(result.records).toHaveLength(1);
    const artifact = result.records[0]?.artifact;
    expect(artifact?.relativePath).toContain(".linghun/session/tool-results/session-a/");
    expect(artifact?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(stat(artifact?.path ?? "")).resolves.toBeTruthy();
    await expect(readFile(artifact?.path ?? "", "utf8")).resolves.toBe(large);
  });

  it("persists largest fresh results when aggregate tool_result budget is exceeded", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const contents = {
      "call-read": `READ_AGG:${"r".repeat(45_000)}`,
      "call-bash": `BASH_AGG:${"b".repeat(45_000)}`,
      "call-index": `INDEX_AGG:${"i".repeat(45_000)}`,
      "call-agent": `AGENT_AGG:${"a".repeat(45_000)}`,
      "call-workflow": `WORKFLOW_AGG:${"w".repeat(45_000)}`,
    };
    const result = await applyToolResultBudgetToMessages(
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call-read", name: "Read", input: { path: "large.txt" } },
            { id: "call-bash", name: "Bash", input: { command: "large" } },
            { id: "call-index", name: "IndexOperation", input: { action: "inspect" } },
            { id: "call-agent", name: "StartAgent", input: { role: "planner", task: "x" } },
            { id: "call-workflow", name: "RunWorkflow", input: { goal: "x" } },
          ],
        },
        ...Object.entries(contents).map(([tool_call_id, content]) => ({
          role: "tool" as const,
          tool_call_id,
          content,
        })),
      ],
      { projectPath: project, sessionId: "session-b" },
    );

    const tools = result.messages.filter((message) => message.role === "tool");
    expect(tools.map((message) => (message.role === "tool" ? message.tool_call_id : ""))).toEqual([
      "call-read",
      "call-bash",
      "call-index",
      "call-agent",
      "call-workflow",
    ]);
    expect(result.records.every((record) => record.reason === "aggregate_message")).toBe(true);
    expect(result.records.length).toBeGreaterThanOrEqual(1);
    expect(
      tools.some((message) => message.role === "tool" && message.content.includes("artifactPath:")),
    ).toBe(true);
    for (const record of result.records) {
      await expect(readFile(record.artifact.path, "utf8")).resolves.toMatch(/^[A-Z]+_AGG:/u);
    }
  });

  it("persists Bash and RunWorkflow tool_results without changing their tool_call_id pairing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const bash = `BASH_BIG_START\n${"b".repeat(55_000)}\nBASH_BIG_END`;
    const workflow = `WORKFLOW_BIG_START\n${"w".repeat(55_000)}\nWORKFLOW_BIG_END`;
    const result = await applyToolResultBudgetToMessages(
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call-bash", name: "Bash", input: { command: "large" } },
            { id: "call-workflow", name: "RunWorkflow", input: { goal: "large" } },
          ],
        },
        { role: "tool", tool_call_id: "call-bash", content: bash },
        { role: "tool", tool_call_id: "call-workflow", content: workflow },
      ],
      { projectPath: project, sessionId: "session-c" },
    );

    const tools = result.messages.filter((message) => message.role === "tool");
    expect(tools.map((message) => (message.role === "tool" ? message.tool_call_id : ""))).toEqual([
      "call-bash",
      "call-workflow",
    ]);
    expect(result.records.map((record) => record.toolUseId).sort()).toEqual([
      "call-bash",
      "call-workflow",
    ]);
    for (const tool of tools) {
      expect(tool.role === "tool" ? tool.content : "").toContain("<persisted-tool-result>");
      expect(tool.role === "tool" ? tool.content : "").toContain("sha256:");
    }
    for (const record of result.records) {
      await expect(readFile(record.artifact.path, "utf8")).resolves.toContain("_BIG_END");
    }
  });

  it("reuses state for repeated large tool_results without new artifact records", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const state: ToolResultBudgetState = { seenIds: new Set(), replacements: new Map() };
    const large = `REUSE_BIG_START\n${"x".repeat(55_000)}\nREUSE_BIG_END`;
    const messages = [
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "call-reuse", name: "Read", input: { path: "large.txt" } }],
      },
      { role: "tool" as const, tool_call_id: "call-reuse", content: large },
    ];

    const first = await applyToolResultBudgetToMessages(messages, {
      projectPath: project,
      sessionId: "session-reuse",
      state,
    });
    const second = await applyToolResultBudgetToMessages(messages, {
      projectPath: project,
      sessionId: "session-reuse",
      state,
    });

    expect(first.records).toHaveLength(1);
    expect(second.records).toHaveLength(0);
    expect(second.messages[1]).toEqual(first.messages[1]);
    expect(second.messages[1]?.role === "tool" ? second.messages[1].content : "").toContain(
      "<persisted-tool-result>",
    );
    expect(second.messages[1]?.role === "tool" ? second.messages[1].content : "").not.toContain(
      "REUSE_BIG_END",
    );
  });

  it("does not mark large results seen when artifact persistence fails", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const blockedProjectPath = join(project, "blocked-path");
    await writeFile(blockedProjectPath, "not a directory", "utf8");
    const state: ToolResultBudgetState = { seenIds: new Set(), replacements: new Map() };
    const large = `RETRY_BIG_START\n${"x".repeat(55_000)}\nRETRY_BIG_END`;
    const messages = [
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "call-retry", name: "Read", input: { path: "large.txt" } }],
      },
      { role: "tool" as const, tool_call_id: "call-retry", content: large },
    ];

    await expect(
      applyToolResultBudgetToMessages(messages, {
        projectPath: blockedProjectPath,
        sessionId: "session-retry",
        state,
      }),
    ).rejects.toThrow();
    expect(state.seenIds.size).toBe(0);
    expect(state.replacements.size).toBe(0);

    const retry = await applyToolResultBudgetToMessages(messages, {
      projectPath: project,
      sessionId: "session-retry",
      state,
    });

    expect(retry.records).toHaveLength(1);
    expect(retry.messages[1]?.role === "tool" ? retry.messages[1].content : "").toContain(
      "<persisted-tool-result>",
    );
  });

  it("does not reuse a cached replacement when the same tool id has new content", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const state: ToolResultBudgetState = { seenIds: new Set(), replacements: new Map() };
    const firstLarge = `SAME_ID_FIRST\n${"a".repeat(55_000)}\nFIRST_END`;
    const secondLarge = `SAME_ID_SECOND\n${"b".repeat(55_000)}\nSECOND_END`;
    const makeMessages = (content: string) => [
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "call-same-id", name: "Read", input: { path: "large.txt" } }],
      },
      { role: "tool" as const, tool_call_id: "call-same-id", content },
    ];

    const first = await applyToolResultBudgetToMessages(makeMessages(firstLarge), {
      projectPath: project,
      sessionId: "session-same-id",
      state,
    });
    const second = await applyToolResultBudgetToMessages(makeMessages(secondLarge), {
      projectPath: project,
      sessionId: "session-same-id",
      state,
    });

    expect(first.records).toHaveLength(1);
    expect(second.records).toHaveLength(1);
    expect(second.messages[1]?.role === "tool" ? second.messages[1].content : "").toContain(
      "SAME_ID_SECOND",
    );
    expect(second.messages[1]?.role === "tool" ? second.messages[1].content : "").not.toContain(
      "SAME_ID_FIRST",
    );
  });

  it("keeps previously seen small results frozen when a later aggregate exceeds budget", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const state: ToolResultBudgetState = { seenIds: new Set(), replacements: new Map() };
    const small = `SMALL_FROZEN:${"s".repeat(10_000)}`;
    const freshIds = ["a", "b", "c", "d", "e"];
    const first = await applyToolResultBudgetToMessages(
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-small", name: "Read", input: { path: "small.txt" } }],
        },
        { role: "tool", tool_call_id: "call-small", content: small },
      ],
      { projectPath: project, sessionId: "session-frozen", state },
    );

    const second = await applyToolResultBudgetToMessages(
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call-small", name: "Read", input: { path: "small.txt" } },
            ...freshIds.map((id) => ({
              id: `call-fresh-${id}`,
              name: "Bash",
              input: { command: `large-${id}` },
            })),
          ],
        },
        { role: "tool", tool_call_id: "call-small", content: small },
        ...freshIds.map((id) => ({
          role: "tool" as const,
          tool_call_id: `call-fresh-${id}`,
          content: `FRESH_AGG_${id}:${id.repeat(45_000)}`,
        })),
      ],
      { projectPath: project, sessionId: "session-frozen", state },
    );

    expect(first.records).toHaveLength(0);
    const tools = second.messages.filter((message) => message.role === "tool");
    expect(tools[0]?.role === "tool" ? tools[0].content : "").toBe(small);
    expect(
      tools.slice(1).some((tool) => tool.role === "tool" && tool.content.includes("<persisted-tool-result>")),
    ).toBe(true);
    expect(second.records.map((record) => record.toolUseId)).not.toContain("call-small");
  });
});
