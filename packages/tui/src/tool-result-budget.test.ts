import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendToolResultEvent, createToolEndEvent } from "./evidence-runtime.js";
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
      tools
        .slice(1)
        .some((tool) => tool.role === "tool" && tool.content.includes("<persisted-tool-result>")),
    ).toBe(true);
    expect(second.records.map((record) => record.toolUseId)).not.toContain("call-small");
  });

  it("does not duplicate the same 100KB output through tool_call_end.output and tool_result.content", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-dup-"));
    const toolNames = ["Read", "Grep", "Glob", "Bash", "Capability", "Agent", "Job"];

    for (const toolName of toolNames) {
      const tail = `${toolName.toUpperCase()}_DUP_END_SHOULD_ONLY_BE_IN_ARTIFACT`;
      const large = `${toolName}_DUP_START\n${"x".repeat(100_000)}\n${tail}`;
      const callId = `call-${toolName.toLowerCase()}`;
      const toolEnd = createToolEndEvent(callId, {
        text: large,
        summary: large,
        preview: large,
        details: large,
        data: { nested: large },
        fullOutputPath: join(project, `${toolName}.log`),
      }) as Extract<ReturnType<typeof createToolEndEvent>, { type: "tool_call_end" }>;
      const budgeted = await applyToolResultBudgetToMessages(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: callId, name: toolName, input: { query: toolName } }],
          },
          {
            role: "tool" as const,
            tool_call_id: callId,
            content: JSON.stringify({ tool: toolName, content: large }),
          },
        ],
        { projectPath: project, sessionId: `session-${toolName.toLowerCase()}` },
      );
      const toolResult = budgeted.messages.find((message) => message.role === "tool");

      expect(JSON.stringify(toolEnd.output)).not.toContain(tail);
      expect(JSON.stringify(toolEnd.output)).not.toContain("<persisted-tool-result>");
      expect((toolEnd.output as { summary?: string }).summary).not.toContain(tail);
      expect((toolEnd.output as { preview?: string }).preview).not.toContain(tail);
      expect((toolEnd.output as { details?: unknown }).details).toBeUndefined();
      expect((toolEnd.output as { data?: unknown }).data).toBeUndefined();
      expect(toolResult?.role === "tool" ? toolResult.content : "").toContain(
        "<persisted-tool-result>",
      );
      expect(toolResult?.role === "tool" ? toolResult.content : "").not.toContain(tail);
      expect(budgeted.records).toHaveLength(1);
      await expect(readFile(budgeted.records[0]?.artifact.path ?? "", "utf8")).resolves.toContain(
        tail,
      );
    }
  });

  it("preserves compact diagnostics in transcript tool_end output", () => {
    const diagnostics = Array.from({ length: 6 }, (_, index) => ({
      type: index === 0 ? "service_readiness" : `diagnostic_${index}`,
      severity: index === 1 ? "blocking" : "recoverable",
      evidence: index === 0 ? "connection refused" : `evidence ${index}`,
      suggestion: `suggestion ${index}`,
      ...(index === 0 ? { target: "127.0.0.1:3000", targetHost: "127.0.0.1", targetPort: 3000 } : {}),
    }));
    const toolEnd = createToolEndEvent("call-diagnostics", {
      text: "x".repeat(100_000),
      data: {
        exitCode: 1,
        diagnostics,
      },
      fullOutputPath: "/tmp/bash.log",
    }) as Extract<ReturnType<typeof createToolEndEvent>, { type: "tool_call_end" }>;

    expect(toolEnd.output.text).toContain("Linghun diagnostics:");
    expect(toolEnd.output.text).toContain("- service_readiness: connection refused");
    const compactDiagnostics = (toolEnd.output.data as { diagnostics?: unknown[] }).diagnostics;
    expect(compactDiagnostics).toHaveLength(5);
    expect(compactDiagnostics).toEqual([
      {
        type: "service_readiness",
        severity: "recoverable",
        evidence: "connection refused",
        target: "127.0.0.1:3000",
        targetHost: "127.0.0.1",
        targetPort: 3000,
      },
      { type: "diagnostic_1", severity: "blocking", evidence: "evidence 1" },
      { type: "diagnostic_2", severity: "recoverable", evidence: "evidence 2" },
      { type: "diagnostic_3", severity: "recoverable", evidence: "evidence 3" },
      { type: "diagnostic_4", severity: "recoverable", evidence: "evidence 4" },
    ]);
    expect(JSON.stringify(compactDiagnostics)).not.toContain("suggestion");
    expect(JSON.stringify(compactDiagnostics)).not.toContain("diagnostic_5");
  });

  it("keeps diagnostics in transcript tool_result content for model-visible history", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const events: unknown[] = [];
    const context = {
      projectPath: project,
      tools: { recentDiagnostics: [] },
      store: {
        appendEvent: async (_sessionId: string, event: unknown) => {
          events.push(event);
        },
      },
    };

    await appendToolResultEvent(
      context as unknown as Parameters<typeof appendToolResultEvent>[0],
      "session-diagnostics",
      "call-diagnostics",
      "Bash",
      {
        text: "exit code 1",
        data: {
          exitCode: 1,
          diagnostics: Array.from({ length: 6 }, (_, index) => ({
            type: index === 0 ? "service_readiness" : `diagnostic_${index}`,
            severity: "recoverable",
            evidence: index === 0 ? "connection refused" : `evidence ${index}`,
            suggestion: `suggestion ${index}`,
            ...(index === 0 ? { target: "127.0.0.1:3000", targetHost: "127.0.0.1", targetPort: 3000 } : {}),
          })),
        },
      },
      true,
      "ev-diagnostics",
    );

    const event = events[0] as { content?: { text?: string; data?: unknown } };
    expect(event.content?.text).toContain("Linghun diagnostics:");
    expect(event.content?.text).toContain("- service_readiness: connection refused");
    expect(JSON.stringify(event.content?.data)).not.toContain("suggestion");
    expect(event.content?.data).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          type: "service_readiness",
          severity: "recoverable",
          evidence: "connection refused",
          target: "127.0.0.1:3000",
          targetHost: "127.0.0.1",
          targetPort: 3000,
        }),
      ]),
    });
    expect((event.content?.data as { diagnostics?: unknown[] }).diagnostics).toHaveLength(5);
    expect(JSON.stringify(event.content?.data)).not.toContain("diagnostic_5");
    expect(context.tools.recentDiagnostics).toHaveLength(5);
    expect(context.tools.recentDiagnostics[0]).toEqual({
      source: "Bash",
      type: "service_readiness",
      severity: "recoverable",
      evidence: "connection refused",
      target: "127.0.0.1:3000",
      targetHost: "127.0.0.1",
      targetPort: 3000,
      createdAt: expect.any(String),
      toolUseId: "call-diagnostics",
      evidenceId: "ev-diagnostics",
    });
    expect(JSON.stringify(context.tools.recentDiagnostics)).not.toContain("suggestion");
    expect(JSON.stringify(context.tools.recentDiagnostics)).not.toContain("diagnostic_5");
  });

  it("keeps only the latest 20 recentDiagnostics entries", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const context = {
      projectPath: project,
      tools: {
        // recentDiagnostics is newest-first: old-0 is newest, old-19 is oldest.
        recentDiagnostics: Array.from({ length: 20 }, (_, index) => ({
          source: "Bash" as const,
          type: "old",
          severity: "recoverable",
          evidence: `old-${index}`,
          createdAt: `2026-01-01T00:00:${String(19 - index).padStart(2, "0")}.000Z`,
        })),
      },
      store: { appendEvent: async () => undefined },
    };

    await appendToolResultEvent(
      context as unknown as Parameters<typeof appendToolResultEvent>[0],
      "session-diagnostics",
      "call-new",
      "Bash",
      {
        text: "exit code 1",
        data: {
          diagnostics: [
            {
              type: "service_readiness",
              severity: "recoverable",
              evidence: "new diagnostic",
              suggestion: "do not store",
            },
          ],
        },
      },
      true,
    );

    expect(context.tools.recentDiagnostics).toHaveLength(20);
    expect(context.tools.recentDiagnostics[0]).toMatchObject({
      source: "Bash",
      type: "service_readiness",
      evidence: "new diagnostic",
      toolUseId: "call-new",
    });
    expect(context.tools.recentDiagnostics).not.toContainEqual(
      expect.objectContaining({ evidence: "old-19" }),
    );
  });

  it("attaches compact tool hint data to matching evidence records", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const context = {
      projectPath: project,
      evidence: [
        {
          id: "ev-hint",
          kind: "command_output",
          source: "Bash",
          summary: "bash output",
          supportsClaims: ["Bash"],
          createdAt: new Date().toISOString(),
        },
      ],
      tools: { recentDiagnostics: [] },
      store: { appendEvent: async () => undefined },
    };

    await appendToolResultEvent(
      context as unknown as Parameters<typeof appendToolResultEvent>[0],
      "session-hint",
      "call-hint",
      "Bash",
      {
        text: "exit code 0",
        data: {
          exitCode: 0,
          serviceHint: { target: "127.0.0.1:3000", ready: true },
        },
      },
      false,
      "ev-hint",
    );

    expect(context.evidence[0]).toMatchObject({
      data: { serviceHint: { target: "127.0.0.1:3000", ready: true } },
    });
  });

  it("attaches compact service lifecycle data to matching evidence records", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const context = {
      projectPath: project,
      evidence: [
        {
          id: "ev-service",
          kind: "command_output",
          source: "Bash",
          summary: "service lifecycle output",
          supportsClaims: ["Bash"],
          createdAt: new Date().toISOString(),
        },
      ],
      tools: { recentDiagnostics: [] },
      store: { appendEvent: async () => undefined },
    };

    await appendToolResultEvent(
      context as unknown as Parameters<typeof appendToolResultEvent>[0],
      "session-service",
      "call-service",
      "Bash",
      {
        text: "Service status ready.",
        data: {
          exitCode: 0,
          service: { serviceId: "svc_1", target: "127.0.0.1:3000", ready: true, status: "ready" },
        },
      },
      false,
      "ev-service",
    );

    expect(context.evidence[0]).toMatchObject({
      data: { service: { serviceId: "svc_1", target: "127.0.0.1:3000", ready: true } },
    });
  });

  it("does not change recentDiagnostics when tool result has no diagnostics", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tool-budget-"));
    const sentinel = [
      {
        source: "Bash" as const,
        type: "service_readiness",
        severity: "recoverable",
        evidence: "existing",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const context = {
      projectPath: project,
      tools: { recentDiagnostics: sentinel },
      store: { appendEvent: async () => undefined },
    };

    await appendToolResultEvent(
      context as unknown as Parameters<typeof appendToolResultEvent>[0],
      "session-diagnostics",
      "call-clean",
      "Bash",
      { text: "exit code 0", data: { exitCode: 0 } },
      false,
    );

    expect(context.tools.recentDiagnostics).toBe(sentinel);
  });
});
