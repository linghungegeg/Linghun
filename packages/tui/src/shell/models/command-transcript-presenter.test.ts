import { describe, expect, it } from "vitest";
import type { ProductBlockViewModel } from "../types.js";
import {
  COMMAND_TRANSCRIPT_ID_PREFIX,
  COMMAND_TRANSCRIPT_PREFIX,
  buildCommandBlockId,
  createCommandBlock,
  getCommandTranscriptText,
  isCommandBlock,
  normalizeCommandTitle,
} from "./command-transcript-presenter.js";

describe("normalizeCommandTitle", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeCommandTitle("  /help  ")).toBe("/help");
  });

  it("preserves internal spaces (slash + subcommand args)", () => {
    expect(normalizeCommandTitle("/permissions add allow Bash high")).toBe(
      "/permissions add allow Bash high",
    );
  });
});

describe("buildCommandBlockId", () => {
  it("produces stable id keyed on sequence and slug", () => {
    expect(buildCommandBlockId(1, "/help")).toBe(`${COMMAND_TRANSCRIPT_ID_PREFIX}1:help`);
    expect(buildCommandBlockId(7, "/permissions add allow Bash high")).toBe(
      `${COMMAND_TRANSCRIPT_ID_PREFIX}7:permissions`,
    );
  });

  it("falls back to anon for non-slash garbage", () => {
    expect(buildCommandBlockId(2, "")).toBe(`${COMMAND_TRANSCRIPT_ID_PREFIX}2:anon`);
  });

  it("strips dangerous chars from slug", () => {
    const id = buildCommandBlockId(3, "/foo<script>");
    expect(id).toBe(`${COMMAND_TRANSCRIPT_ID_PREFIX}3:fooscript`);
  });

  it("different sequences produce different ids for the same command", () => {
    expect(buildCommandBlockId(1, "/help")).not.toBe(buildCommandBlockId(2, "/help"));
  });
});

describe("createCommandBlock", () => {
  it("builds a command-kind block with keep:true and empty summary", () => {
    const block = createCommandBlock(1, "/help");
    expect(block.kind).toBe("command");
    expect(block.status).toBe("info");
    expect(block.keep).toBe(true);
    expect(block.summary).toBe("");
    expect(block.title).toBe("/help");
  });

  it("normalizes whitespace in title", () => {
    const block = createCommandBlock(1, "  /model  ");
    expect(block.title).toBe("/model");
  });

  it("never sets detail / nextAction (transcript row stays single-line)", () => {
    const block = createCommandBlock(1, "/help");
    expect(block.detail).toBeUndefined();
    expect(block.nextAction).toBeUndefined();
  });

  it("preserves args in title", () => {
    const block = createCommandBlock(5, "/permissions add allow Bash high");
    expect(block.title).toBe("/permissions add allow Bash high");
  });
});

describe("getCommandTranscriptText", () => {
  it("formats as `❯ /command`", () => {
    const block = createCommandBlock(1, "/help");
    expect(getCommandTranscriptText(block)).toBe(`${COMMAND_TRANSCRIPT_PREFIX} /help`);
  });

  it("returns empty for non-command blocks", () => {
    const other: ProductBlockViewModel = {
      id: "x",
      kind: "tool",
      status: "pass",
      title: "some tool",
      summary: "",
    };
    expect(getCommandTranscriptText(other)).toBe("");
  });

  it("includes args in the printed line", () => {
    const block = createCommandBlock(2, "/permissions add allow Bash high");
    expect(getCommandTranscriptText(block)).toBe(
      `${COMMAND_TRANSCRIPT_PREFIX} /permissions add allow Bash high`,
    );
  });
});

describe("isCommandBlock", () => {
  it("true for command-kind blocks", () => {
    expect(isCommandBlock(createCommandBlock(1, "/help"))).toBe(true);
  });

  it("false for other kinds", () => {
    const other: ProductBlockViewModel = {
      id: "x",
      kind: "tool",
      status: "pass",
      title: "t",
      summary: "",
    };
    expect(isCommandBlock(other)).toBe(false);
  });
});
