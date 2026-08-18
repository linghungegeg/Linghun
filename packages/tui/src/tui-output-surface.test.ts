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
  it("keeps running tool state out of the transcript and renders only its cleaned result", () => {
    const context = createContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(context, blocks);

    output.writeToolRunningBlock("Bash", "call-1", "git status");
    expect(blocks).toHaveLength(0);

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
    expect(blocks[0]?.toolActivity).toMatchObject({
      toolName: "Bash",
      toolUseId: "call-1",
      kind: "bash",
    });
    expect(blocks[0]?.summary).toContain("命令已完成");
    expect(blocks[0]?.summary).not.toContain("退出");
    expect(blocks[0]?.summary).not.toContain("⎿");
  });

  it("does not add repeated running previews to the transcript", () => {
    const context = createContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(context, blocks);

    output.writeToolRunningBlock("Bash", "call-2", "first chunk");
    output.writeToolRunningBlock("Bash", "call-2", "second chunk");

    expect(blocks).toHaveLength(0);
  });

  it("keeps empty running summaries out of the transcript", () => {
    const context = createContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(context, blocks);

    output.writeToolRunningBlock("Read", "call-empty");

    expect(blocks).toHaveLength(0);
  });

  it("keeps exit codes and diagnostics in the retained details, not the main summary", () => {
    const context = createContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(context, blocks);
    const structured = createStructuredToolOutput(
      "Bash",
      {
        text: "boom",
        details: "stderr: connection reset",
        data: { exitCode: 7, diagnostics: [{ type: "network", evidence: "ECONNRESET" }] },
      },
      "zh-CN",
    );

    output.writeStructuredToolOutput(structured, structured.text, "call-error");

    expect(blocks[0]?.summary).not.toContain("退出");
    expect(blocks[0]?.summary).not.toContain("ECONNRESET");
    expect(blocks[0]?.fullText).toContain("stderr: connection reset");
    expect(context.lastFullOutput).toContain("退出码 7");
    expect(context.lastFullOutput).toContain("ECONNRESET");
  });

  it("keeps inline structured tool output from replacing adjacent ordinary output", () => {
    const context = createContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(context, blocks);

    output.write("ordinary output");
    output.writeStructuredToolOutput(
      createStructuredToolOutput("Glob", { text: "src/a.ts", data: { count: 1 } }, "zh-CN"),
    );

    expect(blocks.map((block) => block.messageKind)).toEqual([
      "assistant_text",
      "tool_result_success",
    ]);
    expect(blocks[0]?.fullText).toBe("ordinary output");
    expect(blocks[1]?.id).toContain("tool:Glob:inline:");
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
