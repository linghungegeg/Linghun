import { describe, expect, it } from "vitest";
import type { ProductBlockViewModel } from "../types.js";
import {
  appendTranscriptSourceCell,
  clearTranscriptSource,
  createTranscriptSource,
  findTranscriptSourceCell,
  snapshotTranscriptSourceCells,
  transcriptSourceKindForBlock,
  transcriptSourceRawTextForBlock,
  transcriptSourceToBlocks,
  upsertTranscriptSourceCell,
} from "./transcript-source.js";

describe("transcript source", () => {
  it("snapshots appended blocks so later view mutations cannot rewrite source", () => {
    const source = createTranscriptSource();
    const block: ProductBlockViewModel = {
      id: "assistant-1",
      kind: "details",
      status: "info",
      title: "",
      summary: "alpha",
      fullText: "alpha beta",
      messageKind: "assistant_text",
    };

    appendTranscriptSourceCell(source, {
      id: block.id,
      kind: "assistant",
      block,
    });
    block.fullText = "mutated";

    expect(snapshotTranscriptSourceCells(source)[0]?.block.fullText).toBe("alpha beta");
  });

  it("clears cells with the same source boundary Codex uses for transcript clears", () => {
    const source = createTranscriptSource();
    appendTranscriptSourceCell(source, {
      id: "cmd-1",
      kind: "command",
      block: {
        id: "cmd-1",
        kind: "command",
        status: "info",
        title: "/help",
        summary: "",
      },
    });

    clearTranscriptSource(source);

    expect(snapshotTranscriptSourceCells(source)).toEqual([]);
  });

  it("upserts streaming assistant cells by id to model final source consolidation", () => {
    const source = createTranscriptSource();
    const block: ProductBlockViewModel = {
      id: "assistant-stream",
      kind: "details",
      status: "info",
      title: "",
      summary: "alpha",
      fullText: "alpha",
      messageKind: "assistant_text",
    };

    upsertTranscriptSourceCell(source, { id: block.id, kind: "assistant", block });
    upsertTranscriptSourceCell(source, {
      id: block.id,
      kind: "assistant",
      block: { ...block, fullText: "alpha beta", summary: "alpha beta" },
    });

    const cells = snapshotTranscriptSourceCells(source);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.block.fullText).toBe("alpha beta");
  });

  it("replaces raw source text when later block compaction rewrites fullText", () => {
    const source = createTranscriptSource();
    const block: ProductBlockViewModel = {
      id: "assistant-raw",
      kind: "details",
      status: "info",
      title: "",
      summary: "alpha",
      fullText: "alpha beta gamma",
      messageKind: "assistant_text",
    };

    upsertTranscriptSourceCell(source, {
      id: block.id,
      kind: "assistant",
      block,
      rawText: transcriptSourceRawTextForBlock(block),
    });
    upsertTranscriptSourceCell(source, {
      id: block.id,
      kind: "assistant",
      block: {
        ...block,
        fullText: "<persisted-tui-block-output>\npreview only\n</persisted-tui-block-output>",
      },
      rawText: "<persisted-tui-block-output>\npreview only\n</persisted-tui-block-output>",
    });

    const cell = snapshotTranscriptSourceCells(source)[0];
    expect(cell?.block.fullText).toContain("<persisted-tui-block-output>");
    expect(cell?.rawText).toContain("<persisted-tui-block-output>");
    expect(cell?.rawText).not.toBe("alpha beta gamma");
  });

  it("drops old raw source text when compacted block upsert omits rawText", () => {
    const source = createTranscriptSource();
    const marker = "raw-text-retention-marker";
    const largeText = `alpha ${marker} ${"beta ".repeat(2_000)}`;
    const block: ProductBlockViewModel = {
      id: "assistant-raw-missing",
      kind: "details",
      status: "info",
      title: "",
      summary: "alpha",
      fullText: largeText,
      messageKind: "assistant_text",
    };

    upsertTranscriptSourceCell(source, {
      id: block.id,
      kind: "assistant",
      block,
      rawText: transcriptSourceRawTextForBlock(block),
    });
    upsertTranscriptSourceCell(source, {
      id: block.id,
      kind: "assistant",
      block: {
        ...block,
        fullText: "<compacted-tui-block-output>\npreview only\n</compacted-tui-block-output>",
      },
    });

    const cells = snapshotTranscriptSourceCells(source);
    expect(cells[0]?.rawText).toBeUndefined();
    expect(JSON.stringify(cells)).not.toContain(marker);
  });

  it("projects source cells back to current Ink block snapshots without mutating source", () => {
    const source = createTranscriptSource();
    appendTranscriptSourceCell(source, {
      id: "user-1",
      kind: "user",
      block: {
        id: "user-1",
        kind: "user",
        status: "info",
        title: "hello",
        summary: "",
        fullText: "hello",
        messageKind: "user_text",
      },
    });
    appendTranscriptSourceCell(source, {
      id: "assistant-1",
      kind: "assistant",
      block: {
        id: "assistant-1",
        kind: "details",
        status: "info",
        title: "",
        summary: "answer",
        fullText: "answer",
        messageKind: "assistant_text",
      },
    });

    const blocks = transcriptSourceToBlocks(source);
    blocks[0]!.fullText = "mutated";

    expect(blocks.map((block) => block.id)).toEqual(["user-1", "assistant-1"]);
    expect(snapshotTranscriptSourceCells(source)[0]?.block.fullText).toBe("hello");
  });

  it("preserves terminal-owned display state for source-backed Ink filtering", () => {
    const source = createTranscriptSource();
    const block: ProductBlockViewModel = {
      id: "user-terminal-owned",
      kind: "user",
      status: "info",
      title: "second message",
      summary: "",
      fullText: "second message",
      messageKind: "user_text",
      terminalOwned: true,
    };

    upsertTranscriptSourceCell(source, {
      id: block.id,
      kind: "user",
      block,
    });

    expect(snapshotTranscriptSourceCells(source)[0]?.block.terminalOwned).toBe(true);
    expect(transcriptSourceToBlocks(source)[0]?.terminalOwned).toBe(true);
  });

  it("finds cells by id as immutable snapshots for source-backed replay", () => {
    const source = createTranscriptSource();
    const block: ProductBlockViewModel = {
      id: "assistant-replay",
      kind: "details",
      status: "info",
      title: "",
      summary: "answer",
      fullText: "answer",
      messageKind: "assistant_text",
    };

    appendTranscriptSourceCell(source, {
      id: block.id,
      kind: "assistant",
      block,
    });

    const found = findTranscriptSourceCell(source, "assistant-replay");
    found!.block.fullText = "mutated";

    expect(found?.kind).toBe("assistant");
    expect(findTranscriptSourceCell(source, "missing")).toBeUndefined();
    expect(snapshotTranscriptSourceCells(source)[0]?.block.fullText).toBe("answer");
  });

  it("classifies stable Linghun transcript blocks without accepting panels", () => {
    const assistant: ProductBlockViewModel = {
      id: "assistant",
      kind: "details",
      status: "info",
      title: "",
      summary: "answer",
      fullText: "answer",
      messageKind: "assistant_text",
    };
    const command: ProductBlockViewModel = {
      id: "cmd",
      kind: "command",
      status: "info",
      title: "/status",
      summary: "",
    };
    const permission: ProductBlockViewModel = {
      id: "perm",
      kind: "permission",
      status: "info",
      title: "permission",
      summary: "allow?",
      messageKind: "permission_panel",
    };
    const compactBoundary: ProductBlockViewModel = {
      id: "compact",
      kind: "details",
      status: "info",
      title: "对话已压缩",
      summary: "",
      messageKind: "compact_boundary",
    };

    expect(transcriptSourceKindForBlock(assistant)).toBe("assistant");
    expect(transcriptSourceKindForBlock(command)).toBe("command");
    expect(transcriptSourceKindForBlock(compactBoundary)).toBe("compact_boundary");
    expect(transcriptSourceKindForBlock(permission)).toBeUndefined();
  });
});
