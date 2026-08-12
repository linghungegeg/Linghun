import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { __testCreateShellBlockOutput } from "./details-status-runtime.js";
import type { ProductBlockViewModel } from "./shell/types.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { createStructuredToolOutput } from "./tool-output-presenter.js";
import {
  createTerminalFirstAssistantSink,
  writeToolRunningBlock,
} from "./tui-output-surface.js";

function createContext(): TuiContext {
  return {
    language: "zh-CN",
    notifications: [],
  } as unknown as TuiContext;
}

describe("tui-output-surface", () => {
  it("merges a running tool block into its final structured result", () => {
    const context = createContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(context, blocks);

    output.writeToolRunningBlock("Bash", "call-1", "git status");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("tool_call");
    expect(blocks[0]?.status).toBe("running");
    expect(blocks[0]?.displayBlock?.bordered).toBe(false);

    const structured = createStructuredToolOutput(
      "Bash",
      { text: "clean", data: { exitCode: 0 } },
      "zh-CN",
    );
    output.writeStructuredToolOutput(structured, structured.text, "call-1");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe("tool:Bash:call-1");
    expect(blocks[0]?.messageKind).toBe("tool_result_success");
    expect(blocks[0]?.status).toBe("info");
    expect(blocks[0]?.displayBlock?.bordered).toBe(false);
    expect(blocks[0]?.summary).toContain("命令已完成");
  });

  it("updates repeated running progress for the same tool in place", () => {
    const context = createContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(context, blocks);

    output.writeToolRunningBlock("Bash", "call-2", "first chunk");
    output.writeToolRunningBlock("Bash", "call-2", "second chunk");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe("tool:Bash:call-2");
    expect(blocks[0]?.messageKind).toBe("tool_call");
    expect(blocks[0]?.fullText).toBe("second chunk");
    expect(blocks[0]?.displayBlock?.title).toBe("正在处理");
    expect(blocks[0]?.displayBlock?.body).toBe("second chunk");
    expect(blocks[0]?.displayBlock?.bordered).toBe(false);
  });

  it("keeps running tool helper silent for plain writable fallback", () => {
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    writeToolRunningBlock(output, "Bash", "call-plain", "progress");

    expect(chunks).toEqual([]);
  });

  it("adds background color to terminal-first streamed diff lines", () => {
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    }) as Writable & { isTTY: true };
    output.isTTY = true;

    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      frameTopRow: 10,
      noColor: false,
      rows: 24,
    });

    expect(sink).toBeDefined();
    sink?.stageStableAssistantText("```diff\n-old\n+new\n```\n");
    expect(sink?.commitStableAssistantText()).toBe(true);

    const written = chunks.join("");
    expect(written).toContain("\x1B[48;2;61;26;26;31m-");
    expect(written).toContain("\x1B[48;2;26;61;26;32m+");
  });
});
