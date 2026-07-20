import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { __testCreateShellBlockOutput } from "./details-status-runtime.js";
import type { ProductBlockViewModel } from "./shell/types.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { createStructuredToolOutput } from "./tool-output-presenter.js";
import { writeToolRunningBlock } from "./tui-output-surface.js";

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
    expect(blocks[0]?.fullText).toContain("second chunk");
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
});
