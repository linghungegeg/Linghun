import { describe, expect, it } from "vitest";
import {
  evictCompletedAgents,
  evictCommittedBlocks,
  pruneToolResultBudgetState,
  runMemoryEviction,
} from "./memory-eviction-runtime.js";
import type { TuiContext } from "./index.js";
import type { AgentRun } from "./tui-data-types.js";
import type { ProductBlockViewModel } from "./shell/types.js";
import type { ToolResultBudgetReplacement, ToolResultBudgetState } from "./tool-result-budget.js";
import {
  createTranscriptSource,
  snapshotTranscriptSourceCells,
  transcriptSourceRawTextForBlock,
  upsertTranscriptSourceCell,
} from "./shell/models/transcript-source.js";

describe("memory-eviction-runtime", () => {
  describe("evictCompletedAgents", () => {
    it("不淘汰少于等于 5 个终态 agent", () => {
      const agents: AgentRun[] = [
        createAgent("1", "completed", "Report 1"),
        createAgent("2", "completed", "Report 2"),
        createAgent("3", "completed", "Report 3"),
      ];
      const context = createContext(agents);
      evictCompletedAgents(context);
      expect(agents[0]?.lastResultFullReport).toBe("Report 1");
      expect(agents[1]?.lastResultFullReport).toBe("Report 2");
      expect(agents[2]?.lastResultFullReport).toBe("Report 3");
    });

    it("保留最近 5 个终态 agent，淘汰更早的", () => {
      const agents: AgentRun[] = [];
      for (let i = 0; i < 10; i++) {
        agents.push(createAgent(`${i}`, "completed", `Report ${i}`.repeat(51)));
      }
      const context = createContext(agents);
      evictCompletedAgents(context);
      // 前 5 个应该被淘汰（截断到 400 字符）
      for (let i = 0; i < 5; i++) {
        const agent = agents[i];
        expect(agent?.lastResultFullReport).toContain("…[evicted]");
        expect((agent?.lastResultFullReport ?? "").length).toBeLessThanOrEqual(412); // 400 + "…[evicted]"
        expect(agent?.mailbox).toEqual([]);
        expect(agent?.contextSummary).toBe("");
      }
      // 后 5 个应该保留完整内容
      for (let i = 5; i < 10; i++) {
        const agent = agents[i];
        expect(agent?.lastResultFullReport).toBe(`Report ${i}`.repeat(51));
        expect(agent?.mailbox).toEqual([]);
        expect(agent?.contextSummary).toBe("");
      }
    });

    it("只淘汰终态 agent（completed/failed/cancelled），不淘汰 running/idle", () => {
      const agents: AgentRun[] = [
        createAgent("1", "completed", "A".repeat(500)),
        createAgent("2", "running", "B".repeat(500)),
        createAgent("3", "failed", "C".repeat(500)),
        createAgent("4", "idle", "D".repeat(500)),
        createAgent("5", "cancelled", "E".repeat(500)),
        createAgent("6", "completed", "F".repeat(500)),
      ];
      const context = createContext(agents);
      evictCompletedAgents(context);
      // running 和 idle 不会被计入淘汰，所以终态只有 4 个，都保留
      expect(agents[0]?.lastResultFullReport).toBe("A".repeat(500));
      expect(agents[1]?.lastResultFullReport).toBe("B".repeat(500)); // running 不淘汰
      expect(agents[2]?.lastResultFullReport).toBe("C".repeat(500));
      expect(agents[3]?.lastResultFullReport).toBe("D".repeat(500)); // idle 不淘汰
      expect(agents[4]?.lastResultFullReport).toBe("E".repeat(500));
      expect(agents[5]?.lastResultFullReport).toBe("F".repeat(500));
    });

    it("截断长报告但保留短报告", () => {
      const agents: AgentRun[] = [];
      for (let i = 0; i < 10; i++) {
        agents.push(createAgent(`${i}`, "completed", i < 3 ? "Short" : "X".repeat(500)));
      }
      const context = createContext(agents);
      evictCompletedAgents(context);
      // 前 5 个：前 3 个短报告不截断，后 2 个长报告截断
      expect(agents[0]?.lastResultFullReport).toBe("Short");
      expect(agents[1]?.lastResultFullReport).toBe("Short");
      expect(agents[2]?.lastResultFullReport).toBe("Short");
      expect(agents[3]?.lastResultFullReport).toContain("…[evicted]");
      expect(agents[4]?.lastResultFullReport).toContain("…[evicted]");
      // 后 5 个保留
      for (let i = 5; i < 10; i++) {
        expect(agents[i]?.lastResultFullReport).toBe("X".repeat(500));
      }
    });
  });

  describe("evictCommittedBlocks", () => {
    it("不淘汰少于等于 60 个 block", () => {
      const blocks: ProductBlockViewModel[] = [];
      for (let i = 0; i < 60; i++) {
        blocks.push(createBlock(`${i}`, `Content ${i}`));
      }
      evictCommittedBlocks(blocks);
      for (let i = 0; i < 60; i++) {
        expect(blocks[i]?.fullText).toBe(`Content ${i}`);
      }
    });

    it("保留最近 60 个 block，淘汰更早的", () => {
      const blocks: ProductBlockViewModel[] = [];
      for (let i = 0; i < 100; i++) {
        blocks.push(createBlock(`${i}`, `Content ${i}`.repeat(30)));
      }
      evictCommittedBlocks(blocks);
      // 前 40 个应该被截断
      for (let i = 0; i < 40; i++) {
        expect(blocks[i]?.fullText).toContain("…[evicted]");
        expect((blocks[i]?.fullText ?? "").length).toBeLessThanOrEqual(211); // 200 + "…[evicted]"
      }
      // 后 60 个保留
      for (let i = 40; i < 100; i++) {
        expect(blocks[i]?.fullText).toBe(`Content ${i}`.repeat(30));
      }
    });

    it("截断长文本但保留短文本", () => {
      const blocks: ProductBlockViewModel[] = [];
      for (let i = 0; i < 80; i++) {
        blocks.push(createBlock(`${i}`, i < 10 ? "Short" : "Y".repeat(300)));
      }
      evictCommittedBlocks(blocks);
      // 前 20 个需要淘汰：前 10 个短文本不截断，后 10 个长文本截断
      for (let i = 0; i < 10; i++) {
        expect(blocks[i]?.fullText).toBe("Short");
      }
      for (let i = 10; i < 20; i++) {
        expect(blocks[i]?.fullText).toContain("…[evicted]");
      }
      // 后 60 个保留
      for (let i = 20; i < 80; i++) {
        expect(blocks[i]?.fullText).toBe(i < 10 ? "Short" : "Y".repeat(300));
      }
    });

    it("同步淘汰 transcriptSource 中同 id block 的 rawText", () => {
      const marker = "source-raw-retention-marker";
      const blocks: ProductBlockViewModel[] = [];
      const source = createTranscriptSource();
      for (let i = 0; i < 80; i++) {
        const block = createBlock(`${i}`, `${marker}-${i} ${"Y".repeat(300)}`, "assistant_text");
        blocks.push(block);
        upsertTranscriptSourceCell(source, {
          id: block.id,
          kind: "assistant",
          block,
          rawText: transcriptSourceRawTextForBlock(block),
        });
      }

      evictCommittedBlocks(blocks, source);

      const cells = snapshotTranscriptSourceCells(source);
      expect(blocks[0]?.fullText).toContain("…[evicted]");
      expect(cells[0]?.block.fullText).toBe(blocks[0]?.fullText);
      expect(cells[0]?.rawText).toBe(blocks[0]?.fullText);
      expect(JSON.stringify(cells[0])).not.toContain(`${marker}-0 ${"Y".repeat(300)}`);
      expect(cells[79]?.block.fullText).toContain(`${marker}-79`);
    });
  });

  describe("pruneToolResultBudgetState", () => {
    it("不裁剪少于等于 200 条的 toolResultBudgetState", () => {
      const state = createToolResultBudgetState(200);
      const context = createContextWithBudgetState(state);
      pruneToolResultBudgetState(context);
      expect(state.seenIds.size).toBe(200);
      expect(state.replacements.size).toBe(200);
      expect(state.contentReplacements?.size).toBe(200);
    });

    it("保留最近 200 条，裁剪更早的", () => {
      const state = createToolResultBudgetState(300);
      const context = createContextWithBudgetState(state);
      pruneToolResultBudgetState(context);
      expect(state.seenIds.size).toBe(200);
      expect(state.replacements.size).toBe(200);
      expect(state.contentReplacements?.size).toBe(200);
      // 前 100 个 ID 应该被删除（id-0 到 id-99）
      for (let i = 0; i < 100; i++) {
        expect(state.seenIds.has(`id-${i}`)).toBe(false);
        expect(state.replacements.has(`id-${i}`)).toBe(false);
        expect(state.contentReplacements?.has(createContentReplacementKey(i))).toBe(false);
      }
      // 后 200 个保留（id-100 到 id-299）
      for (let i = 100; i < 300; i++) {
        expect(state.seenIds.has(`id-${i}`)).toBe(true);
        expect(state.replacements.has(`id-${i}`)).toBe(true);
        expect(state.contentReplacements?.has(createContentReplacementKey(i))).toBe(true);
      }
    });

    it("处理空 toolResultBudgetState", () => {
      const context = createContextWithBudgetState(undefined);
      pruneToolResultBudgetState(context);
      // 不应该报错
      expect(context.toolResultBudgetState).toBeUndefined();
    });
  });

  describe("runMemoryEviction", () => {
    it("一次性运行所有淘汰逻辑", () => {
      const agents: AgentRun[] = [];
      for (let i = 0; i < 10; i++) {
        agents.push(createAgent(`${i}`, "completed", `Report ${i}`.repeat(51)));
      }
      const blocks: ProductBlockViewModel[] = [];
      for (let i = 0; i < 80; i++) {
        blocks.push(createBlock(`${i}`, `Content ${i}`.repeat(30)));
      }
      const state = createToolResultBudgetState(250);
      const context = createContextWithAll(agents, state);
      runMemoryEviction(context, blocks);

      // 验证 agents 被淘汰
      expect(agents[0]?.lastResultFullReport).toContain("…[evicted]");
      expect(agents[9]?.lastResultFullReport).not.toContain("…[evicted]");

      // 验证 blocks 被淘汰
      expect(blocks[0]?.fullText).toContain("…[evicted]");
      expect(blocks[79]?.fullText).not.toContain("…[evicted]");

      // 验证 toolResultBudgetState 被裁剪
      expect(state.seenIds.size).toBe(200);
      expect(state.contentReplacements?.size).toBe(200);
    });
  });
});

// Helper functions
function createAgent(
  id: string,
  status: AgentRun["status"],
  report: string,
): AgentRun {
  return {
    id,
    type: "worker",
    role: "executor",
    provider: "test",
    task: "test task",
    model: "test-model",
    permissionMode: "default",
    status,
    lastResultFullReport: report,
    transcriptPath: `/tmp/agent-${id}`,
    transcriptSessionId: `session-${id}`,
    mailbox: [],
    summary: "",
    contextSummary: "",
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCny: 0,
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createBlock(
  id: string,
  fullText: string,
  messageKind?: ProductBlockViewModel["messageKind"],
): ProductBlockViewModel {
  return {
    id,
    kind: "details",
    status: "info",
    title: `Block ${id}`,
    summary: `Summary ${id}`,
    fullText,
    ...(messageKind ? { messageKind } : {}),
  };
}

function createContext(agents: AgentRun[]): TuiContext {
  return { agents } as Pick<TuiContext, "agents"> as TuiContext;
}

function createToolResultBudgetState(count: number): ToolResultBudgetState {
  const seenIds = new Set<string>();
  const replacements: ToolResultBudgetState["replacements"] = new Map();
  const contentReplacements: NonNullable<ToolResultBudgetState["contentReplacements"]> = new Map();
  for (let i = 0; i < count; i++) {
    const id = `id-${i}`;
    const replacement: ToolResultBudgetReplacement = {
      summary: `replacement-${i}`,
      fingerprint: createStateReplacementKey(id, i),
      record: {
        toolUseId: id,
        originalChars: 1000,
        replacementChars: 100,
        artifact: {
          id: `artifact-${i}`,
          toolUseId: id,
          path: `/tmp/tool-result-${i}.txt`,
          relativePath: `tool-results/tool-result-${i}.txt`,
          bytes: 1000,
          chars: 1000,
          sha256: `sha256-${i}`,
          previewChars: 100,
          preview: `preview-${i}`,
          hasMore: false,
        },
        reason: "single_result",
      },
    };
    seenIds.add(id);
    replacements.set(id, replacement);
    contentReplacements.set(createContentReplacementKey(i), replacement);
  }
  return { seenIds, replacements, contentReplacements };
}

function createStateReplacementKey(id: string, index: number): string {
  return ["session", id, 1000, 1000, `sha256-${index}`].join("\0");
}

function createContentReplacementKey(index: number): string {
  return ["session", 1000, 1000, `sha256-${index}`].join("\0");
}

function createContextWithBudgetState(
  state: ReturnType<typeof createToolResultBudgetState> | undefined,
): TuiContext {
  return { toolResultBudgetState: state } as Pick<TuiContext, "toolResultBudgetState"> as TuiContext;
}

function createContextWithAll(
  agents: AgentRun[],
  state: ReturnType<typeof createToolResultBudgetState>,
): TuiContext {
  return {
    agents,
    toolResultBudgetState: state,
  } as Pick<TuiContext, "agents" | "toolResultBudgetState"> as TuiContext;
}
