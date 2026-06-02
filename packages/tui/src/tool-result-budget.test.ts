import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyToolResultBudgetToMessages } from "./tool-result-budget.js";

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
    expect(tools.some((message) => message.role === "tool" && message.content.includes("artifactPath:"))).toBe(
      true,
    );
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
});
