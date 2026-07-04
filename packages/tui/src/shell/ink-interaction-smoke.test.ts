import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInkShell } from "./ink-renderer.js";
import {
  nativeScrollbackTaskFrameHeight,
  nativeScrollbackTaskHistoryGeometry,
} from "./native-scrollback-frame.js";
import { resetTerminalCapabilityCache } from "./terminal-capability.js";
import {
  commitTerminalFirstUserBlock,
  createTerminalFirstAssistantSink,
} from "../tui-output-surface.js";
import { getCoreSlashCandidates } from "../slash-dispatch.js";
import type {
  ProductBlockViewModel,
  ShellController,
  ShellInputEvent,
  ShellViewModel,
} from "./types.js";

class TestTtyOutput extends Writable {
  readonly chunks: string[] = [];
  isTTY = true;
  columns = 100;
  rows = 28;

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === "resize") {
      this.chunks.push(`\x1B]LH_ROWS=${this.rows}\x07`);
    }
    return super.emit(eventName, ...args);
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  get text(): string {
    return this.chunks.join("");
  }
}

function createTtyInput(): PassThrough & {
  isTTY: boolean;
  setRawMode: (value: boolean) => void;
  ref: () => void;
  unref: () => void;
} {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (value: boolean) => void;
    ref: () => void;
    unref: () => void;
  };
  input.isTTY = true;
  input.setRawMode = () => undefined;
  input.ref = () => undefined;
  input.unref = () => undefined;
  return input;
}

function baseTaskView(): ShellViewModel {
  return {
    language: "zh-CN",
    projectName: "Linghun",
    projectPath: "F:/Linghun",
    width: 100,
    height: 28,
    mode: "ink",
    themeMode: "no-color",
    viewMode: "task",
    brand: "LingHun",
    homeVision: "",
    status: {
      project: "项目：Linghun",
      model: "模型：gpt-5.5",
      permission: "权限：默认模式",
      trust: "信任：已信任",
      index: "索引：ready",
      background: "后台：1",
    },
    composer: {
      placeholder: "我能帮您做点什么？",
      taskPlaceholder: "输入消息或 /help",
      submittedHint: "正在处理上一条消息",
      masking: false,
      setupActive: false,
    },
    blocks: [
      {
        id: "block-1",
        kind: "tool",
        status: "partial",
        title: "真实任务",
        summary: "runtime task output",
        fullText: "runtime task output\nhidden details",
        nextAction: "Ctrl+O 查看完整内容",
        messageKind: "tool_result_success",
      },
    ],
    limitations: [],
    taskFooter: {
      permissionMode: "默认模式",
      model: "gpt-5.5",
      cache: "缓存 42%",
      index: "索引 ready",
      cyclePermHint: "Shift+Tab 切换模式",
    },
    commandPanel: {
      title: "/index status",
      summary: ["索引 ready"],
      detailsText: "Index status\n- status: ready",
    },
    transcriptScroll: { scrollOffset: 0, stickToBottom: true, hasOverflow: true },
    transcriptViewportGeometry: {
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      contentHeight: 40,
      topOffset: 20,
    },
  };
}

async function renderWithEvents(getViewModel: () => ShellViewModel): Promise<{
  input: ReturnType<typeof createTtyInput>;
  output: TestTtyOutput;
  events: ShellInputEvent[];
  shell: ReturnType<typeof renderInkShell>;
}> {
  vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
  vi.stubEnv("FORCE_COLOR", "0");
  const input = createTtyInput();
  const output = new TestTtyOutput();
  const events: ShellInputEvent[] = [];
  const controller: ShellController = {
    getViewModel,
    onInput: (event) => {
      events.push(event);
    },
  };
  const shell = renderInkShell(controller, {
    stdin: input,
    stdout: output,
    stderr: new TestTtyOutput(),
  });
  await shell.waitUntilRenderFlush();
  return { input, output, events, shell };
}

async function writeInput(
  input: ReturnType<typeof createTtyInput>,
  shell: ReturnType<typeof renderInkShell>,
  value: string,
): Promise<void> {
  input.write(value);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await shell.waitUntilRenderFlush();
}

function visibleLinesFrom(output: TestTtyOutput): string[] {
  return output.text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "").split(/\r?\n/u);
}

function finalScreenLinesFrom(output: TestTtyOutput, rowCount = 80): string[] {
  const rows = Array.from({ length: rowCount }, () => [] as string[]);
  let row = 0;
  let col = 0;
  let savedRow = 0;
  let savedCol = 0;
  let scrollTop = 0;
  let visibleRowCount = rows.length;
  let scrollBottom = visibleRowCount - 1;
  const text = output.text;

  const setVisibleRowCount = (nextRowCount: number) => {
    visibleRowCount = Math.max(1, nextRowCount);
    while (rows.length < visibleRowCount) rows.push([]);
    if (scrollBottom >= visibleRowCount) scrollBottom = visibleRowCount - 1;
    if (scrollTop > scrollBottom) scrollTop = scrollBottom;
    if (row >= visibleRowCount) row = visibleRowCount - 1;
  };

  const ensureRow = () => {
    while (row >= rows.length) rows.push([]);
  };

  const scrollRegionUp = () => {
    for (let scrollRow = scrollTop; scrollRow < scrollBottom; scrollRow += 1) {
      rows[scrollRow] = [...(rows[scrollRow + 1] ?? [])];
    }
    rows[scrollBottom] = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\x1B") {
      const next = text[index + 1];
      if (next === "[") {
        let end = index + 2;
        while (end < text.length && !/[A-Za-z~]/u.test(text[end] ?? "")) end += 1;
        const command = text[end] ?? "";
        const params = text.slice(index + 2, end);
        const numeric = params
          .replace(/[?=>]/gu, "")
          .split(";")
          .map((value) => Number.parseInt(value, 10));
        if (command === "H" || command === "f") {
          row = Math.max(0, (numeric[0] || 1) - 1);
          col = Math.max(0, (numeric[1] || 1) - 1);
        } else if (command === "A") {
          row = Math.max(0, row - (numeric[0] || 1));
        } else if (command === "B") {
          row += numeric[0] || 1;
          ensureRow();
        } else if (command === "G") {
          col = Math.max(0, (numeric[0] || 1) - 1);
        } else if (command === "r") {
          const top = numeric[0];
          const bottom = numeric[1];
          if (Number.isFinite(top) && Number.isFinite(bottom)) {
            scrollTop = Math.max(0, top - 1);
            scrollBottom = Math.max(scrollTop, Math.min(visibleRowCount - 1, bottom - 1));
          } else {
            scrollTop = 0;
            scrollBottom = visibleRowCount - 1;
          }
          row = 0;
          col = 0;
        } else if (command === "J") {
          if (params.includes("2")) {
            for (const line of rows) line.splice(0, line.length);
          } else {
            rows[row]?.splice(col);
            for (let clearRow = row + 1; clearRow < visibleRowCount; clearRow += 1) {
              rows[clearRow]?.splice(0);
            }
          }
        } else if (command === "K") {
          ensureRow();
          rows[row]?.splice(col);
        } else if (command === "s") {
          savedRow = row;
          savedCol = col;
        } else if (command === "u") {
          row = savedRow;
          col = savedCol;
        }
        index = end;
        continue;
      }
      if (next === "]") {
        const end = text.indexOf("\x07", index + 2);
        if (end >= 0) {
          const osc = text.slice(index + 2, end);
          const rowsMatch = /^LH_ROWS=(\d+)$/u.exec(osc);
          if (rowsMatch) setVisibleRowCount(Number.parseInt(rowsMatch[1] ?? "0", 10));
          index = end;
          continue;
        }
      }
      if (next === ">" || next === "<" || next === "=") {
        index += 1;
        continue;
      }
      continue;
    }
    if (char === "\r") {
      col = 0;
      continue;
    }
    if (char === "\n") {
      if (row === scrollBottom) {
        scrollRegionUp();
      } else {
        row += 1;
        ensureRow();
      }
      col = 0;
      continue;
    }
    ensureRow();
    rows[row]![col] = char ?? "";
    col += 1;
  }

  return rows.slice(0, visibleRowCount).map((line) => line.join(""));
}

describe("Ink TTY interaction smoke", () => {
  afterEach(() => {
    resetTerminalCapabilityCache();
    vi.unstubAllEnvs();
  });

  it("reports transcript viewport geometry again when only width changes", async () => {
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    let view = { ...baseTaskView(), commandPanel: undefined };
    const { events, shell } = await renderWithEvents(() => view);
    const firstGeometryCount = events.filter(
      (event) => event.type === "transcript-viewport-geometry",
    ).length;

    view = { ...view, width: 80 };
    shell.rerender();
    await shell.waitUntilRenderFlush();

    const geometryEvents = events.filter(
      (event): event is Extract<ShellInputEvent, { type: "transcript-viewport-geometry" }> =>
        event.type === "transcript-viewport-geometry",
    );
    expect(geometryEvents.length).toBeGreaterThan(firstGeometryCount);
    expect(geometryEvents.at(-1)?.geometry.width).toBeLessThan(100);
    shell.unmount();
  });

  it("drives CommandPanel, Ctrl+O, task scroll, footer, and permission focus through TTY keys", async () => {
    let view = baseTaskView();
    const { input, output, events, shell } = await renderWithEvents(() => view);

    expect(output.text).toContain("索引 ready");
    expect(output.text).not.toContain("gpt-5.5");

    input.write("\x0f");
    await shell.waitUntilRenderFlush();
    expect(events).toContainEqual({ type: "toggle-details" });

    input.write("\x1b[5~");
    input.write("\x1b[6~");
    input.write("\x1b[H");
    input.write("\x1b[F");
    input.write("\x1b[A");
    input.write("\x1b[B");
    await shell.waitUntilRenderFlush();
    expect(events).toContainEqual({ type: "transcript-scroll", action: "halfPageUp" });
    expect(events).toContainEqual({ type: "transcript-scroll", action: "halfPageDown" });
    expect(events).toContainEqual({ type: "transcript-scroll", action: "top" });
    expect(events).toContainEqual({ type: "transcript-scroll", action: "bottom" });
    expect(events).not.toContainEqual({ type: "transcript-scroll", action: "wheelUp" });
    expect(events).not.toContainEqual({ type: "transcript-scroll", action: "wheelDown" });

    input.write("\x1b");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await shell.waitUntilRenderFlush();
    expect(events).toContainEqual({ type: "command-panel-close" });
    expect(events).not.toContainEqual({ type: "escape" });

    view = {
      ...view,
      commandPanel: undefined,
      permission: {
        toolName: "Write",
        reason: "default 模式需要确认",
        risk: "medium",
        scope: ["report.md"],
        hint: "选择权限动作",
        actions: [
          { id: "allow_once", label: "允许本次", shortcut: "y" },
          { id: "deny", label: "拒绝", shortcut: "n" },
          { id: "cancel", label: "取消" },
        ],
      },
    };
    shell.rerender();
    await shell.waitUntilRenderFlush();

    const beforePermissionEvents = events.length;
    input.write("x");
    await shell.waitUntilRenderFlush();
    expect(events.slice(beforePermissionEvents)).not.toContainEqual({
      type: "permission-action",
      actionId: "allow_once",
    });
    expect(events.slice(beforePermissionEvents)).not.toContainEqual({ type: "submit", text: "x" });

    input.write("y");
    await shell.waitUntilRenderFlush();
    expect(events).toContainEqual({ type: "permission-action", actionId: "allow_once" });

    view = {
      ...view,
      permission: {
        toolName: "Write",
        reason: "default 模式需要确认",
        risk: "medium",
        scope: ["report.md"],
        hint: "选择权限动作",
        actions: [
          { id: "allow_once", label: "允许本次", shortcut: "y" },
          { id: "deny", label: "拒绝", shortcut: "n" },
          { id: "cancel", label: "取消" },
        ],
      },
    };
    shell.rerender();
    await shell.waitUntilRenderFlush();
    input.write("n");
    await shell.waitUntilRenderFlush();
    expect(events).toContainEqual({ type: "permission-action", actionId: "deny" });

    shell.unmount();
  });

  it("routes selectable background CommandPanel keys to panel actions", async () => {
    const view = {
      ...baseTaskView(),
      commandPanel: {
        title: "/background",
        summary: ["任务 · 运行中 2 · 待确认 0 · 失败/阻塞 0 · 已完成 0"],
        sections: [
          {
            title: "Agent",
            rows: [
              {
                text: "Agent a · 运行中 · -",
                taskRef: { id: "agent-a", kind: "agent" as const },
                detailsText: "Agent a details",
              },
            ],
          },
          {
            title: "Bash / job",
            rows: [
              {
                text: "Bash lint · 运行中 · -",
                taskRef: { id: "bash-a", kind: "background" as const },
                detailsText: "Bash details",
              },
            ],
          },
        ],
        cursor: 0,
        scrollOffset: 0,
        expanded: false,
      },
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    input.write("\x1b[B");
    await shell.waitUntilRenderFlush();
    input.write("\x1b[A");
    await shell.waitUntilRenderFlush();
    input.write("\r");
    await shell.waitUntilRenderFlush();
    input.write("x");
    await shell.waitUntilRenderFlush();
    input.write("\x1b");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await shell.waitUntilRenderFlush();

    expect(events).toContainEqual({ type: "command-panel-move", delta: 1 });
    expect(events).toContainEqual({ type: "command-panel-move", delta: -1 });
    expect(events).toContainEqual({ type: "command-panel-toggle" });
    expect(events).toContainEqual({ type: "command-panel-stop" });
    expect(events).toContainEqual({ type: "command-panel-close" });
    expect(events).not.toContainEqual({ type: "transcript-scroll", action: "wheelDown" });
    expect(events).not.toContainEqual({ type: "submit", text: "x" });

    shell.unmount();
  });

  it("opens the background overlay with Shift+Down", async () => {
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      backgroundTaskOverlay: undefined,
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    await writeInput(input, shell, "\x1b[1;2B");

    expect(events).toContainEqual({ type: "background-overlay-open" });
    expect(events).not.toContainEqual({ type: "transcript-scroll", action: "lineDown" });
    shell.unmount();
  });

  it("absorbs panel navigation keys for non-selectable CommandPanel rows", async () => {
    const view = {
      ...baseTaskView(),
      commandPanel: {
        title: "/index status",
        summary: ["索引 ready"],
        detailsText: "Index status",
      },
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    await writeInput(input, shell, "\x1b[B");
    await writeInput(input, shell, "\r");

    expect(events).not.toContainEqual({ type: "transcript-scroll", action: "wheelDown" });
    expect(events).not.toContainEqual({ type: "submit", text: "" });
    expect(events).not.toContainEqual({ type: "empty-submit" });
    shell.unmount();
  });

  it("routes default normal-screen wheel while keeping drag selection out of the app router", async () => {
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    vi.stubEnv("LINGHUN_FULLSCREEN", "0");
    vi.stubEnv("LINGHUN_TUI_MOUSE", "1");
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      transcriptViewportGeometry: {
        x: 0,
        y: 2,
        width: 80,
        height: 8,
        contentHeight: 40,
        topOffset: 20,
      },
    };
    const { input, output, events, shell } = await renderWithEvents(() => view);

    expect(output.text).toContain("\x1B[?1000h");
    expect(output.text).toContain("\x1B[?1006h");
    expect(output.text).not.toContain("\x1B[?1002h");
    expect(output.text).not.toContain("\x1B[?1003h");
    expect(output.text).not.toContain("\x1B[?1007h");

    await writeInput(input, shell, "\x1b[<64;10;5M");
    await writeInput(input, shell, "\x1b[<65;10;5M");
    await writeInput(input, shell, "\x1b[<65;10;20M");
    await writeInput(input, shell, "\x1b[<0;10;5M");
    await writeInput(input, shell, "\x1b[<32;12;6M");
    await writeInput(input, shell, "\x1b[<0;12;6m");

    expect(events).toContainEqual({ type: "transcript-scroll", delta: 1 });
    expect(events).toContainEqual({ type: "transcript-scroll", delta: -1 });
    expect(events.some((event) => event.type === "transcript-mouse")).toBe(false);

    shell.unmount();
  });

  it("routes default empty-input arrows through transcript scroll for terminal wheel bridge", async () => {
    vi.unstubAllEnvs();
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      taskSuggestions: undefined,
      agentProgressTree: undefined,
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    await writeInput(input, shell, "\x1b[A");
    await writeInput(input, shell, "\x1b[B");

    expect(events).toContainEqual({ type: "transcript-scroll", action: "lineUp" });
    expect(events).toContainEqual({ type: "transcript-scroll", action: "lineDown" });
    shell.unmount();
  });

  it("keeps arrow-key app transcript scroll in native scrollback compatibility mode", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      taskSuggestions: undefined,
      agentProgressTree: undefined,
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    await writeInput(input, shell, "\x1b[A");
    await writeInput(input, shell, "\x1b[B");

    expect(events).toContainEqual({ type: "transcript-scroll", action: "lineUp" });
    expect(events).toContainEqual({ type: "transcript-scroll", action: "lineDown" });
    shell.unmount();
  });

  it("first submit keeps the user message and pending activity visible in the native bottom frame", async () => {
    vi.unstubAllEnvs();
    const userBlock: ProductBlockViewModel = {
      id: "first-submit-user",
      kind: "user" as const,
      status: "info" as const,
      title: "你是谁",
      summary: "你是谁",
      fullText: "你是谁",
      messageKind: "user_text" as const,
      keep: true,
    };
    let view: ShellViewModel = {
      ...baseTaskView(),
      viewMode: "task",
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      commandPanel: undefined,
      taskFooter: undefined,
      transcriptScroll: undefined,
      transcriptViewportGeometry: undefined,
    };
    const { output, shell } = await renderWithEvents(() => view);
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    view = {
      ...baseTaskView(),
      viewMode: "pending",
      blocks: [userBlock],
      staticHistoryBlocks: [userBlock],
      activity: { phase: "thinking", text: "连接模型..." },
      commandPanel: undefined,
      taskFooter: {
        permissionMode: "默认模式",
        model: "claude-opus-4-8",
        cache: "缓存？",
        index: "索引 ready",
        reasoning: "推理 High",
        cyclePermHint: "Shift+Tab 切换模式",
      },
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
      transcriptViewportGeometry: undefined,
    };
    shell.clearTransientFrame();
    shell.rerender();
    await shell.waitUntilRenderFlush();

    const lines = finalScreenLinesFrom(output, 40);
    const activityLine = lines.findIndex((line) => line.includes("连接模型"));
    const activityCount = lines.filter((line) => line.includes("连接模型")).length;
    const composerLine = lines.findIndex(
      (line) => line.includes("输入消息") || line.includes("继续输入"),
    );
    const footerLine = lines.findIndex((line) => line.includes("claude-opus-4-8"));
    expect(lines.join("\n")).toContain("你是谁");
    expect(activityLine).toBeGreaterThanOrEqual(0);
    expect(activityCount).toBe(1);
    expect(activityLine).toBeGreaterThan(lines.findIndex((line) => line.includes("你是谁")));
    expect(composerLine).toBeGreaterThan(activityLine);
    expect(footerLine).toBeGreaterThan(composerLine);
    expect(lines.slice(footerLine + 1).join("\n")).not.toContain("你是谁");
    shell.unmount();
  });

  it("keeps compact footer visible while task list and working status are active", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const view: ShellViewModel = {
      ...baseTaskView(),
      commandPanel: undefined,
      activity: { phase: "thinking", text: "提交请求…", elapsed: "3m20s" },
      taskListView: {
        rows: [
          {
            id: "task-1",
            subject: "抽样 ccb/codex 的 composer/status/bottom pane",
            status: "in_progress",
          },
          {
            id: "task-2",
            subject: "形成分阶段方案",
            status: "pending",
          },
        ],
        hiddenPending: 0,
      },
      agentProgressTree: {
        rows: [
          {
            id: "agent-1",
            branch: "last",
            name: "audit",
            status: "running",
            activity: "reading",
            toolUses: 2,
            tokens: 1024,
          },
        ],
        hiddenPending: 0,
        cursor: -1,
      },
    };
    const { output, shell } = await renderWithEvents(() => view);
    await shell.waitUntilRenderFlush();

    const visible = finalScreenLinesFrom(output, view.height).join("\n");
    expect(visible).toContain("提交请求");
    expect(visible).toContain("输入消息");
    expect(visible).toContain("gpt-5.5");
    shell.unmount();
  });

  it("terminal-first user flush survives the following Ink rerender clear", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    let geometry = {
      x: 0,
      y: 17,
      width: 100,
      height: 10,
      contentHeight: 10,
      topOffset: 0,
    };
    const userBlock: ProductBlockViewModel = {
      id: "terminal-first-user",
      kind: "user" as const,
      status: "info" as const,
      title: "你是谁",
      summary: "你是谁",
      fullText: "你是谁",
      messageKind: "user_text" as const,
      keep: true,
    };
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const sink = createTerminalFirstAssistantSink(output, {
      noColor: true,
      columns: () => output.columns,
      rows: () => output.rows,
      viewportGeometry: () => geometry,
    });
    const blocks = [userBlock];
    let view: ShellViewModel = {
      ...baseTaskView(),
      commandPanel: undefined,
      blocks,
      staticHistoryBlocks: blocks,
      activity: { phase: "thinking", text: "连接模型...", elapsed: "2s" },
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
      transcriptViewportGeometry: geometry,
    };
    const shell = renderInkShell(
      {
        getViewModel: () => view,
        onInput: (event) => {
          if (event.type === "transcript-viewport-geometry") {
            geometry = event.geometry;
            view = { ...view, transcriptViewportGeometry: geometry };
          }
        },
      },
      {
        stdin: input,
        stdout: output,
        stderr: new TestTtyOutput(),
      },
    );
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    expect(commitTerminalFirstUserBlock(sink, userBlock)).toBe(true);
    shell.rerender();
    await shell.waitUntilRenderFlush();

    const lastUser = output.text.lastIndexOf("你是谁");
    const lastFullClear = output.text.lastIndexOf("\x1B[2J");
    expect(lastUser).toBeGreaterThanOrEqual(0);
    expect(lastUser).toBeGreaterThan(lastFullClear);
    expect(finalScreenLinesFrom(output, 40).join("\n")).toContain("你是谁");
    shell.unmount();
  });

  it("default task render keeps the composer visible without the experimental bottom frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    vi.stubEnv("LINGHUN_FULLSCREEN", "0");
    const view = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [
        {
          id: "short-user-history",
          kind: "user" as const,
          status: "info" as const,
          title: "你有什么能力",
          summary: "你有什么能力",
          fullText: "你有什么能力",
          messageKind: "user_text" as const,
          keep: true,
        },
      ],
      streamingAssistantText: undefined,
      activity: { phase: "thinking" as const, text: "连接模型..." },
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();

    const text = output.text;
    expect(text).not.toContain("\x1B[?1049h");
    expect(text).toContain("输入消息或 /help");
    expect(text).toContain("默认模式");
    expect(text).toContain("你有什么能力");
    expect(text).toContain("连接模型");
    const visibleLines = text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "").split(/\r?\n/u);
    const historyLine = visibleLines.findIndex((line) => line.includes("你有什么能力"));
    const activityLine = visibleLines.findIndex((line) => line.includes("连接模型"));
    const composerLine = visibleLines.findIndex((line) => line.includes("输入消息或 /help"));
    expect(activityLine - historyLine).toBeGreaterThan(0);
    expect(activityLine - historyLine).toBeLessThanOrEqual(3);
    expect(composerLine - activityLine).toBeGreaterThan(0);
    expect(composerLine - activityLine).toBeLessThanOrEqual(4);
    expect(text).not.toContain("\x1B[18;1H");
    expect(composerLine).toBeGreaterThan(activityLine);
    shell.unmount();
  });

  it("normal-screen frame height stays pinned when terminal history is large", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const longHistory = Array.from({ length: 80 }, (_, index) => `历史行 ${index + 1}`).join("\n");
    const view = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [
        {
          id: "large-history",
          kind: "details" as const,
          status: "pass" as const,
          title: "",
          summary: "历史行 1",
          fullText: longHistory,
          messageKind: "assistant_text" as const,
          keep: true,
        },
      ],
      streamingAssistantText: undefined,
      activity: { phase: "thinking" as const, text: "连接模型..." },
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, events, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();

    const nativeFrameHeight = nativeScrollbackTaskFrameHeight(view);
    const nativeFrameTop = view.height - nativeFrameHeight;
    expect(output.text).toContain(`\x1B[${nativeFrameTop + 1};1H`);
    expect(
      events.some((event) => event.type === "transcript-viewport-geometry"),
    ).toBe(false);
    shell.unmount();
  });

  it("normal-screen frame stays small while idle and expands for submitted activity", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const idleView = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
    };
    const submittedView = {
      ...idleView,
      activity: { phase: "thinking" as const, text: "提交请求..." },
    };

    expect(nativeScrollbackTaskFrameHeight(idleView)).toBeLessThan(
      nativeScrollbackTaskFrameHeight(submittedView),
    );
  });

  it("normal-screen frame uses a bounded height while slash suggestions are visible", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const idleView = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
      composerOverlayRows: 0,
    };
    const slashView = {
      ...idleView,
      composerOverlayRows: 6,
    };

    expect(nativeScrollbackTaskFrameHeight(slashView)).toBeGreaterThan(
      nativeScrollbackTaskFrameHeight(idleView),
    );
    expect(nativeScrollbackTaskFrameHeight(slashView)).toBeLessThan(slashView.height);
  });

  it("normal-screen frame returns to compact height for completed activity", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const idleView = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
    };
    const completedView = {
      ...idleView,
      activity: { phase: "completed" as const, text: "完成" },
    };

    expect(nativeScrollbackTaskFrameHeight(completedView)).toBe(
      nativeScrollbackTaskFrameHeight(idleView),
    );
  });


  it("native scrollback history geometry uses the bottom frame as the live viewport", () => {
    const view = baseTaskView();
    const frameHeight = nativeScrollbackTaskFrameHeight(view);
    const frameTop = view.height - frameHeight;
    const geometry = nativeScrollbackTaskHistoryGeometry(view);

    expect(geometry.y).toBe(frameTop);
    expect(geometry.height).toBe(frameTop);
    expect(geometry.width).toBe(view.width);
  });

  it("idle native scrollback task render anchors only the compact bottom frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const view = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      streamingAssistantText: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
    };
    const { output, shell } = await renderWithEvents(() => view);
    await shell.waitUntilRenderFlush();

    const activeAnchorRow = view.height - 10 + 1;
    const compactAnchorRow = view.height - nativeScrollbackTaskFrameHeight(view) + 1;
    expect(output.text).not.toContain(`\x1B[${activeAnchorRow};1H`);
    expect(output.text).toContain(`\x1B[${compactAnchorRow};1H`);
    expect(output.text).toContain(`\x1B[${compactAnchorRow};${output.rows}r\x1B[${compactAnchorRow};1H`);
    shell.unmount();
  });

  it("idle native scrollback task frame shows footer before the first input", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const view = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      streamingAssistantText: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
    };
    const { output, shell } = await renderWithEvents(() => view);
    await shell.waitUntilRenderFlush();

    const visible = finalScreenLinesFrom(output, view.height).join("\n");
    expect(visible).toContain("输入消息或 /help");
    expect(visible).toContain("gpt-5.5");
    expect(visible).toContain("缓存 42%");
    expect(visible).toContain("索引 ready");
    shell.unmount();
  });

  it("fullscreen config panel is not anchored into the native bottom frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const view = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
      configPanel: {
        phase: "panel_list" as const,
        cursor: 0,
        scrollOffset: 0,
        panels: [
          {
            id: "model",
            title: "模型",
            summary: "查看当前模型 / provider / 角色路由。",
            slash: "/model",
          },
        ],
      },
    };
    const { output, shell } = await renderWithEvents(() => view);
    await shell.waitUntilRenderFlush();

    const activeAnchorRow = view.height - 10 + 1;
    expect(output.text).toContain("CONFIG");
    expect(output.text).toContain("模型");
    expect(output.text).not.toContain("/model");
    expect(output.text).not.toContain("查看当前模型");
    expect(output.text).not.toContain(`\x1B[${activeAnchorRow};1H`);
    shell.unmount();
  });

  it("fullscreen panels use alternate screen in native scrollback mode", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    let view: ShellViewModel = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
      configPanel: undefined,
    };
    const { output, shell } = await renderWithEvents(() => view);
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    view = {
      ...view,
      configPanel: {
        phase: "panel_list" as const,
        cursor: 0,
        scrollOffset: 0,
        panels: [
          {
            id: "model",
            title: "模型",
            summary: "查看当前模型 / provider / 角色路由。",
            slash: "/model",
          },
        ],
      },
    };
    shell.rerender();
    await shell.waitUntilRenderFlush();
    expect(output.text).toContain("\x1B[?1049h");

    output.chunks.length = 0;
    view = { ...view, configPanel: undefined };
    shell.rerender();
    await shell.waitUntilRenderFlush();
    expect(output.text).toContain("\x1B[?1049l");
    expect(output.text).toContain("\x1B[1;1H\x1B[J");
    expect(output.text).toMatch(/\x1B\[\d+;1H\x1B\[J/u);
    expect(output.text).toMatch(/\x1B\[\d+;1H/u);
    shell.unmount();
  });

  it("fullscreen help and command panels are not anchored into the native bottom frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const helpView = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
      helpPanel: {
        group: "advanced" as const,
        cursor: 0,
        scrollOffset: 0,
        entries: [
          { slash: "/config", description: "高级配置" },
          { slash: "/model", description: "模型信息" },
        ],
      },
    };
    const commandView = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: {
        title: "/model",
        summary: ["模型信息"],
        detailsText: "provider: test",
      },
    };

    for (const view of [helpView, commandView]) {
      const { output, shell } = await renderWithEvents(() => view);
      await shell.waitUntilRenderFlush();

      const activeAnchorRow = view.height - 10 + 1;
      expect(output.text).not.toContain(`\x1B[${activeAnchorRow};1H`);
      shell.unmount();
    }
  });

  it("keeps completed task turns out of the native bottom composer frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const view = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [
        {
          id: "latest-user",
          kind: "user" as const,
          status: "info" as const,
          title: "你是谁",
          summary: "你是谁",
          fullText: "你是谁",
          messageKind: "user_text" as const,
          keep: true,
        },
        {
          id: "latest-assistant",
          kind: "details" as const,
          status: "pass" as const,
          title: "",
          summary: "我是 Kiro",
          fullText: "我是 Kiro，一个 AI 编程助手。",
          messageKind: "assistant_text" as const,
          keep: true,
        },
      ],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();

    const visibleLines = visibleLinesFrom(output);
    const userLine = visibleLines.findIndex((line) => line.includes("你是谁"));
    const assistantLine = visibleLines.findIndex((line) => line.includes("我是 Kiro"));
    const composerLine = visibleLines.findIndex((line) => line.includes("输入消息或 /help"));
    expect(userLine).toBe(-1);
    expect(assistantLine).toBe(-1);
    expect(composerLine).toBeGreaterThanOrEqual(0);
    shell.unmount();
  });

  it("moves older turns to Static while keeping the current user turn at the bottom", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    const view = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [
        {
          id: "older-user",
          kind: "user" as const,
          status: "info" as const,
          title: "第一条",
          summary: "第一条",
          fullText: "第一条",
          messageKind: "user_text" as const,
          keep: true,
        },
        {
          id: "older-assistant",
          kind: "details" as const,
          status: "pass" as const,
          title: "",
          summary: "第一条回复",
          fullText: [
            "第一条回复",
            "补充内容 01",
            "补充内容 02",
            "补充内容 03",
            "补充内容 04",
            "补充内容 05",
            "补充内容 06",
            "补充内容 07",
            "补充内容 08",
            "补充内容 09",
            "补充内容 10",
            "补充内容 11",
            "补充内容 12",
            "补充内容 13",
            "补充内容 14",
            "补充内容 15",
            "补充内容 16",
          ].join("\n"),
          messageKind: "assistant_text" as const,
          keep: true,
        },
        {
          id: "current-user",
          kind: "user" as const,
          status: "info" as const,
          title: "第二条",
          summary: "第二条",
          fullText: "第二条",
          messageKind: "user_text" as const,
          keep: true,
        },
      ],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();

    const visibleLines = visibleLinesFrom(output);
    const olderLine = visibleLines.findIndex((line) => line.includes("第一条回复"));
    const currentLine = visibleLines.findIndex((line) => line.includes("第二条"));
    const composerLine = visibleLines.findIndex((line) => line.includes("输入消息或 /help"));
    expect(olderLine).toBeGreaterThanOrEqual(0);
    expect(currentLine).toBeGreaterThan(olderLine);
    expect(composerLine - currentLine).toBeGreaterThan(0);
    expect(composerLine - currentLine).toBeLessThanOrEqual(4);
    shell.unmount();
  });

  it("keeps short multi-turn task history stacked above the bottom composer", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    const view = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [
        {
          id: "first-user",
          kind: "user" as const,
          status: "info" as const,
          title: "你是谁",
          summary: "你是谁",
          fullText: "你是谁",
          messageKind: "user_text" as const,
          keep: true,
        },
        {
          id: "first-assistant",
          kind: "details" as const,
          status: "pass" as const,
          title: "",
          summary: "我是 Linghun",
          fullText: "我是 Linghun，一个工程型 AI 编程助手。",
          messageKind: "assistant_text" as const,
          keep: true,
        },
        {
          id: "second-user",
          kind: "user" as const,
          status: "info" as const,
          title: "你有什么能力",
          summary: "你有什么能力",
          fullText: "你有什么能力",
          messageKind: "user_text" as const,
          keep: true,
        },
      ],
      streamingAssistantText: undefined,
      activity: { phase: "thinking" as const, text: "提交请求..." },
      taskSuggestions: undefined,
      limitations: [],
      commandPanel: undefined,
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();

    const visibleLines = visibleLinesFrom(output);
    const assistantLine = visibleLines.findIndex((line) => line.includes("我是 Linghun"));
    const currentLine = visibleLines.findIndex((line) => line.includes("你有什么能力"));
    const activityLine = visibleLines.findIndex((line) => line.includes("提交请求"));
    const composerLine = visibleLines.findIndex((line) => line.includes("输入消息或 /help"));
    expect(assistantLine).toBeGreaterThanOrEqual(0);
    expect(currentLine).toBeGreaterThan(assistantLine);
    expect(activityLine).toBeGreaterThan(currentLine);
    expect(composerLine - activityLine).toBeGreaterThan(0);
    expect(composerLine - activityLine).toBeLessThanOrEqual(4);
    shell.unmount();
  });

  it("keeps terminal-owned source history out of the live Ink frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [
        {
          id: "live-assistant",
          kind: "details" as const,
          status: "pass" as const,
          title: "",
          summary: "第二条回复",
          fullText: "第二条回复已经开始输出",
          messageKind: "assistant_text" as const,
          keep: true,
        },
      ],
      streamingAssistantText: "第二条回复已经开始输出",
      staticHistoryBlocks: [
        {
          id: "first-user",
          kind: "user" as const,
          status: "info" as const,
          title: "第一条用户消息",
          summary: "第一条用户消息",
          fullText: "第一条用户消息",
          messageKind: "user_text" as const,
          keep: true,
          terminalOwned: true,
        },
        {
          id: "first-assistant",
          kind: "details" as const,
          status: "pass" as const,
          title: "",
          summary: "第一条回复",
          fullText: "第一条回复",
          messageKind: "assistant_text" as const,
          keep: true,
          terminalOwned: true,
        },
        {
          id: "second-user",
          kind: "user" as const,
          status: "info" as const,
          title: "第二条用户消息",
          summary: "第二条用户消息",
          fullText: "第二条用户消息",
          messageKind: "user_text" as const,
          keep: true,
          terminalOwned: true,
        },
      ],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();

    const visibleLines = visibleLinesFrom(output);
    const firstUserLine = visibleLines.findIndex((line) => line.includes("第一条用户消息"));
    const liveAssistantLine = visibleLines.findIndex((line) => line.includes("第二条回复已经开始输出"));
    const composerLine = visibleLines.findIndex((line) => line.includes("输入消息或 /help"));
    expect(firstUserLine).toBe(-1);
    expect(visibleLines.join("\n")).not.toContain("第二条用户消息");
    expect(liveAssistantLine).toBeGreaterThanOrEqual(0);
    expect(composerLine).toBeGreaterThanOrEqual(0);
    shell.unmount();
  });

  it("native-scrollback task resize clears the bottom frame without replaying history", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    vi.stubEnv("LINGHUN_TUI_MOUSE", "1");
    let reflowRequests = 0;
    // Plan A single ownership: a block committed to terminal history is
    // physically removed from view.blocks, so the Ink frame holds no committed
    // rows. Resize must clear only the bottom frame and never replay history.
    const view = () => ({
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    });
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller: ShellController = {
      getViewModel: view,
      onInput: () => undefined,
    };
    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output as unknown as NodeJS.WriteStream,
      beforeNativeScrollbackResizeReflow: () => {
        reflowRequests += 1;
      },
    });
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    output.emit("resize");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    await shell.waitUntilRenderFlush();

    // Resize never triggers the (now removed) history replay callback.
    expect(reflowRequests).toBe(0);
    // Frame-only clear: cursor to the frame anchor row + clear-to-end, not a
    // full-screen wipe, so native scrollback history above the frame is kept.
    const resizedView = view();
    const nativeFrameTop = resizedView.height - nativeScrollbackTaskFrameHeight(resizedView);
    expect(output.text).toContain(`\x1B[${nativeFrameTop + 1};1H`);
    expect(output.text).not.toContain("\x1B[3J");
    shell.unmount();
  });

  it("native-scrollback 24-to-12-to-30 resize leaves only one live composer and footer", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    let width = 100;
    let height = 24;
    const view = () => ({
      ...baseTaskView(),
      width,
      height,
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    });
    const output = new TestTtyOutput();
    output.rows = height;
    output.columns = width;
    const input = createTtyInput();
    const shell = renderInkShell(
      {
        getViewModel: view,
        onInput: () => undefined,
      },
      {
        stdin: input,
        stdout: output as unknown as NodeJS.WriteStream,
      },
    );
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    for (const size of [
      { height: 12, width: 84 },
      { height: 30, width: 110 },
    ]) {
      height = size.height;
      width = size.width;
      output.rows = size.height;
      output.columns = size.width;
      output.emit("resize");
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      await shell.waitUntilRenderFlush();
    }

    const finalLines = finalScreenLinesFrom(output, height);
    const composerCount = finalLines.filter((line) =>
      /输入消息或 \/help|继续输入/u.test(line),
    ).length;
    const modelCount = finalLines.filter((line) => line.includes("gpt-5.5")).length;
    const cacheCount = finalLines.filter((line) => line.includes("缓存 42%")).length;
    const indexCount = finalLines.filter((line) => line.includes("索引 ready")).length;
    const shrinkClearFrom = 12 - nativeScrollbackTaskFrameHeight({ ...view(), height: 12 }) + 1;
    expect(composerCount).toBe(1);
    expect(modelCount).toBe(1);
    expect(cacheCount).toBe(1);
    expect(indexCount).toBe(1);
    expect(output.text).toContain(`\x1B[${shrinkClearFrom};1H\x1B[J`);
    expect(output.text).not.toContain("\x1B[2J\x1B[H");
    expect(output.text).not.toContain("\x1B[3J");
    shell.unmount();
  });

  it("native-scrollback resize clears top-of-viewport frame remnants from terminal reflow", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    let width = 100;
    let height = 28;
    const view = () => ({
      ...baseTaskView(),
      width,
      height,
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    });
    const output = new TestTtyOutput();
    output.rows = height;
    output.columns = width;
    const input = createTtyInput();
    const shell = renderInkShell(
      {
        getViewModel: view,
        onInput: () => undefined,
      },
      {
        stdin: input,
        stdout: output as unknown as NodeJS.WriteStream,
      },
    );
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    output.chunks.push("\x1B[1;1H╭ stale old composer ╮\x1B[2;1H│  › 继续输入...");
    height = 22;
    width = 76;
    output.rows = height;
    output.columns = width;
    output.emit("resize");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    await shell.waitUntilRenderFlush();

    const finalLines = finalScreenLinesFrom(output, height);
    expect(output.text).toContain("\x1B[1;1H\x1B[J");
    expect(finalLines[0]).not.toContain("stale old composer");
    expect(finalLines[1]).not.toContain("继续输入");
    expect(finalLines.filter((line) => /输入消息或 \/help|继续输入/u.test(line)).length).toBe(1);
    expect(output.text).not.toContain("\x1B[2J\x1B[H");
    expect(output.text).not.toContain("\x1B[3J");
    shell.unmount();
  });

  it("native-scrollback task resize clears from the previous frame anchor when the frame moves down", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    let height = 22;
    const view = () => ({
      ...baseTaskView(),
      height,
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    });
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller: ShellController = {
      getViewModel: view,
      onInput: () => undefined,
    };
    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output as unknown as NodeJS.WriteStream,
    });
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    height = 28;
    output.emit("resize");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    await shell.waitUntilRenderFlush();

    const nextAnchorRow = height - nativeScrollbackTaskFrameHeight(view()) + 1;
    const previousAnchorRow = 22 - nativeScrollbackTaskFrameHeight({ ...view(), height: 22 }) + 1;
    expect(output.text).toContain(`\x1B[${previousAnchorRow};1H\x1B[J`);
    expect(output.text.lastIndexOf(`\x1B[${nextAnchorRow};1H`)).toBeGreaterThan(
      output.text.indexOf(`\x1B[${previousAnchorRow};1H\x1B[J`),
    );
    expect(output.text).not.toContain("\x1B[2J\x1B[H");
    expect(output.text).not.toContain("\x1B[3J");
    shell.unmount();
  });

  it("normal-screen resize keeps source-backed history out of the native Ink frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    vi.stubEnv("LINGHUN_TUI_MOUSE", "1");
    let generation = 0;
    const historyBlocks = [
      {
        id: "resize-history-1",
        kind: "user" as const,
        status: "info" as const,
        title: "你是谁",
        summary: "你是谁",
        fullText: "你是谁",
        messageKind: "user_text" as const,
        keep: true,
      },
      {
        id: "resize-history-2",
        kind: "details" as const,
        status: "pass" as const,
        title: "",
        summary: "我是 Linghun",
        fullText: "我是 Linghun",
        messageKind: "assistant_text" as const,
        keep: true,
      },
    ];
    const view = () => ({
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: historyBlocks,
      staticHistoryReplayGeneration: generation,
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    });
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller: ShellController = {
      getViewModel: view,
      onInput: () => undefined,
    };
    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output as unknown as NodeJS.WriteStream,
      beforeNativeScrollbackResizeReflow: () => {
        generation += 1;
      },
    });
    await shell.waitUntilRenderFlush();

    for (let i = 0; i < 3; i += 1) {
      output.chunks.length = 0;
      output.emit("resize");
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      await shell.waitUntilRenderFlush();
      expect(output.text).not.toContain("你是谁");
      expect(output.text).not.toContain("我是 Linghun");
    }
    expect(generation).toBe(0);
    shell.unmount();
  });

  it("opt-in native scrollback resize clears the viewport once without terminal-first replay", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    let replayRequests = 0;
    const view = () => ({
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [
        {
          id: "default-resize-user",
          kind: "user" as const,
          status: "info" as const,
          title: "默认 resize 用户消息",
          summary: "默认 resize 用户消息",
          fullText: "默认 resize 用户消息",
          messageKind: "user_text" as const,
          keep: true,
        },
        {
          id: "default-resize-assistant",
          kind: "details" as const,
          status: "pass" as const,
          title: "",
          summary: "默认 resize 回复",
          fullText: "默认 resize 回复",
          messageKind: "assistant_text" as const,
          keep: true,
        },
      ],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    });
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const shell = renderInkShell(
      {
        getViewModel: view,
        onInput: () => undefined,
      },
      {
        stdin: input,
        stdout: output as unknown as NodeJS.WriteStream,
        beforeNativeScrollbackResizeReflow: () => {
          replayRequests += 1;
        },
      },
    );
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    output.emit("resize");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    await shell.waitUntilRenderFlush();

    // Native scrollback history stays terminal-owned. Resize clears only the
    // live bottom frame (no visible-screen or scrollback wipe) and never
    // replays history.
    expect(output.text).toMatch(/\x1B\[\d+;1H\x1B\[J/u);
    expect(output.text).not.toContain("\x1B[2J\x1B[H");
    expect(output.text).not.toContain("\x1B[3J");
    expect(replayRequests).toBe(0);
    shell.unmount();
  });

  it("normal-screen native frame leaves source history out of Ink rerenders", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    let view = {
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [
        {
          id: "history-1",
          kind: "details" as const,
          status: "info" as const,
          title: "",
          summary: "first history row",
          fullText: "first history row",
          messageKind: "assistant_text" as const,
        },
      ],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, shell } = await renderWithEvents(() => view);
    await shell.waitUntilRenderFlush();
    expect(output.text).not.toContain("first history row");

    output.chunks.length = 0;
    view = {
      ...view,
      staticHistoryBlocks: [
        ...(view.staticHistoryBlocks ?? []),
        {
          id: "history-2",
          kind: "details" as const,
          status: "info" as const,
          title: "",
          summary: "second history row",
          fullText: "second history row",
          messageKind: "assistant_text" as const,
        },
      ],
    };
    shell.rerender();
    await shell.waitUntilRenderFlush();

    expect(output.text).not.toContain("second history row");
    expect(output.text).not.toContain("first history row");
    shell.unmount();
  });

  it("normal-screen native frame confines Ink erase/redraw output to the bottom frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { input, output, events, shell } = await renderWithEvents(() => view);
    await shell.waitUntilRenderFlush();

    const anchorRow = view.height - nativeScrollbackTaskFrameHeight(view) + 1;
    output.chunks.length = 0;
    await writeInput(input, shell, "a");

    expect(output.text).toContain(`\x1B[${anchorRow};1H\x1B[J`);
    expect(output.text).not.toContain("\x1B[1A");
    shell.unmount();
  });

  it("normal-screen native resize keeps the composer buffer mounted", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    let composerDraftText = "";
    const view = (): ShellViewModel => {
      const base = baseTaskView();
      return {
        ...base,
        composer: { ...base.composer, draftText: composerDraftText },
        commandPanel: undefined,
        blocks: [],
        staticHistoryBlocks: [],
        activity: undefined,
        taskSuggestions: undefined,
        limitations: [],
        transcriptScroll: { scrollOffset: 0, stickToBottom: true },
      };
    };
    const input = createTtyInput();
    const output = new TestTtyOutput();
    let shell: ReturnType<typeof renderInkShell>;
    const controller: ShellController = {
      getViewModel: view,
      onInput: (event) => {
        if (event.type === "composer-draft-change") {
          composerDraftText = event.text;
        }
      },
    };
    shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();

    await writeInput(input, shell, "abc");
    expect(composerDraftText).toBe("abc");
    output.chunks.length = 0;
    output.emit("resize");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    await shell.waitUntilRenderFlush();

    expect(composerDraftText).toBe("abc");
    expect(output.text).not.toContain("\x1B[2J\x1B[H");
    expect(output.text).not.toContain("\x1B[3J");
    shell.unmount();
  });

  it("normal-screen native frame clears the old compact frame when activity expands it", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    let activity: ShellViewModel["activity"];
    const view = () => ({
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [],
      activity,
      taskSuggestions: undefined,
      limitations: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    });
    const { output, shell } = await renderWithEvents(view);
    await shell.waitUntilRenderFlush();

    const compactAnchorRow = view().height - nativeScrollbackTaskFrameHeight(view()) + 1;
    output.chunks.length = 0;
    activity = { phase: "thinking" as const, text: "生成回答中..." };
    shell.rerender();
    await shell.waitUntilRenderFlush();

    const activeAnchorRow = view().height - nativeScrollbackTaskFrameHeight(view()) + 1;
    expect(activeAnchorRow).toBeLessThan(compactAnchorRow);
    expect(output.text).toContain(`\x1B[r\x1B[${activeAnchorRow};1H\x1B[J`);
    expect(output.text).not.toContain("\x1B[2J\x1B[H");
    const visible = finalScreenLinesFrom(output, view().height).join("\n");
    expect(visible.match(/输入消息或 \/help|继续输入/gu)?.length ?? 0).toBe(1);
    shell.unmount();
  });

  it("normal-screen native frame clears the previous paint region during local composer repaint", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    let activity: ShellViewModel["activity"] = { phase: "thinking", text: "生成回答中..." };
    const view = () => ({
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [],
      activity,
      taskSuggestions: undefined,
      limitations: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    });
    const { input, output, shell } = await renderWithEvents(view);
    await shell.waitUntilRenderFlush();

    const expandedAnchorRow = view().height - nativeScrollbackTaskFrameHeight(view()) + 1;
    activity = undefined;
    output.chunks.length = 0;
    await writeInput(input, shell, "x");

    const compactAnchorRow = view().height - nativeScrollbackTaskFrameHeight(view()) + 1;
    expect(compactAnchorRow).toBeGreaterThan(expandedAnchorRow);
    expect(output.text).toContain(`\x1B[${expandedAnchorRow};1H\x1B[J`);
    expect(output.text).not.toContain("\x1B[2J\x1B[H");
    expect(output.text).not.toContain("\x1B[3J");

    const visible = finalScreenLinesFrom(output, view().height);
    expect(visible.filter((line) => line.includes("╭")).length).toBeLessThanOrEqual(1);
    shell.unmount();
  });

  it("normal-screen transcript does not render user rows already committed to terminal history", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    // Plan A single ownership: once a user row is committed to terminal history
    // it is physically removed from view.blocks. It lives only in
    // staticHistoryBlocks (the canonical transcript source), never in the Ink
    // frame, so the bottom frame does not echo it.
    const committedUser = {
      id: "same-user",
      kind: "user" as const,
      status: "info" as const,
      title: "同一条用户消息",
      summary: "同一条用户消息",
      fullText: "同一条用户消息",
      messageKind: "user_text" as const,
      keep: true,
    };
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [committedUser],
      streamingAssistantText: undefined,
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();

    const visible = visibleLinesFrom(output).join("\n");
    expect(visible).not.toContain("同一条用户消息");
    shell.unmount();
  });

  it("normal-screen does not echo an assistant block once it has left the Ink frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    // Plan A single ownership: a committed assistant block is removed from
    // view.blocks, so the native bottom frame renders nothing for it.
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [],
      streamingAssistantText: undefined,
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();

    const visible = visibleLinesFrom(output).join("\n");
    expect(visible).not.toContain("already terminal-owned live block");
    shell.unmount();
  });

  it("normal-screen streaming keeps only the live assistant tail in the native bottom frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const longOlderReply = Array.from(
      { length: 18 },
      (_, index) => `older reply line ${index + 1}`,
    ).join("\n");
    let streamingText = "正在输出第二条回复";
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      blocks: [],
      staticHistoryBlocks: [
        {
          id: "older-user",
          kind: "user" as const,
          status: "info" as const,
          title: "第一条用户消息",
          summary: "第一条用户消息",
          fullText: "第一条用户消息",
          messageKind: "user_text" as const,
          keep: true,
        },
        {
          id: "older-assistant",
          kind: "details" as const,
          status: "pass" as const,
          title: "",
          summary: "older reply line 1",
          fullText: longOlderReply,
          messageKind: "assistant_text" as const,
          keep: true,
        },
        {
          id: "latest-user",
          kind: "user" as const,
          status: "info" as const,
          title: "第二条用户消息",
          summary: "第二条用户消息",
          fullText: "第二条用户消息",
          messageKind: "user_text" as const,
          keep: true,
        },
      ],
      get streamingAssistantText() {
        return streamingText;
      },
      activity: undefined,
      taskSuggestions: undefined,
      limitations: [],
      transcriptScroll: { scrollOffset: 0, stickToBottom: true },
    };
    const { output, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();

    const visibleLines = visibleLinesFrom(output);
    const userLine = visibleLines.findIndex((line) => line.includes("第二条用户消息"));
    const streamingLine = visibleLines.findIndex((line) => line.includes("正在输出第二条回复"));
    const composerLine = visibleLines.findIndex((line) => line.includes("输入消息或 /help"));
    expect(userLine).toBe(-1);
    expect(streamingLine).toBeGreaterThanOrEqual(0);
    expect(composerLine).toBeGreaterThanOrEqual(0);

    output.chunks.length = 0;
    streamingText = "正在输出第二条回复\n继续输出";
    shell.rerender();
    await shell.waitUntilRenderFlush();
    const rerendered = visibleLinesFrom(output).join("\n");
    expect(rerendered).not.toContain("第二条用户消息");
    expect(rerendered).toContain("继续输出");
    expect(rerendered).toContain("正在输出第二条回复");
    shell.unmount();
  });

  it("clearTransientFrame keeps the legacy full-screen clear when native scrollback is disabled", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    const view = {
      ...baseTaskView(),
      viewMode: "task" as const,
      blocks: [],
      activity: undefined,
      taskFooter: undefined,
      transcriptScroll: undefined,
    };
    const { output, shell } = await renderWithEvents(() => view);

    await shell.waitUntilRenderFlush();
    shell.clearTransientFrame();

    expect(output.text).toContain("\x1B[2J\x1B[H");
    expect(output.text).not.toContain("\x1B[3J");
    shell.unmount();
  });

  it("clearTransientFrame runs cleanup before clearing the visible frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    const view = {
      ...baseTaskView(),
      viewMode: "task" as const,
      blocks: [],
      activity: undefined,
      taskFooter: undefined,
      transcriptScroll: undefined,
    };
    const cleanup = vi.fn();
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller: ShellController = {
      getViewModel: () => view,
      onInput: () => undefined,
    };
    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output as unknown as NodeJS.WriteStream,
      beforeClearTransientFrame: cleanup,
    });
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    shell.clearTransientFrame();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(output.text).toContain("\x1B[2J\x1B[H");
    expect(output.text).not.toContain("\x1B[3J");
    shell.unmount();
  });

  it("clearTransientFrame clears only the native bottom frame", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const view = {
      ...baseTaskView(),
      blocks: [],
      staticHistoryBlocks: [],
      activity: undefined,
      commandPanel: undefined,
    };
    const { output, shell } = await renderWithEvents(() => view);
    await shell.waitUntilRenderFlush();

    output.chunks.length = 0;
    shell.clearTransientFrame();

    const anchorRow = view.height - nativeScrollbackTaskFrameHeight(view) + 1;
    const clearBottomFrame = `\x1B[r\x1B[${anchorRow};1H\x1B[J`;
    const frameClear = output.text.indexOf(clearBottomFrame);
    const finalAnchor = output.text.lastIndexOf(`\x1B[${anchorRow};1H`);
    expect(frameClear).toBeGreaterThanOrEqual(0);
    expect(finalAnchor).toBeGreaterThan(frameClear);
    expect(output.text).not.toContain("\x1B[2J\x1B[H");
    expect(output.text).not.toContain("\x1B[3J");
    shell.unmount();
  });

  it("renders selected background row details only when expanded", async () => {
    let view = {
      ...baseTaskView(),
      commandPanel: {
        title: "/background",
        summary: ["任务 · 运行中 2 · 待确认 0 · 失败/阻塞 0 · 已完成 0"],
        sections: [
          {
            title: "Agent",
            rows: [
              {
                text: "Agent a · 运行中 · -",
                taskRef: { id: "agent-a", kind: "agent" as const },
                detailsText: "Agent a details",
              },
              {
                text: "Agent b · 运行中 · -",
                taskRef: { id: "agent-b", kind: "agent" as const },
                detailsText: "Agent b details",
              },
            ],
          },
        ],
        cursor: 1,
        scrollOffset: 0,
        expanded: false,
      },
    };
    const { output, shell } = await renderWithEvents(() => view);

    expect(output.text).toContain("> Agent b");
    expect(output.text).not.toContain("Agent b details");

    view = {
      ...view,
      commandPanel: {
        ...view.commandPanel,
        expanded: true,
      },
    };
    shell.rerender();
    await shell.waitUntilRenderFlush();

    expect(output.text).toContain("Agent b details");
    expect(output.text).not.toContain("Agent a details");

    shell.unmount();
  });

  it("selects task suggestions with arrows and Enter", async () => {
    let view: ShellViewModel = {
      ...baseTaskView(),
      commandPanel: undefined,
      taskSuggestions: [
        {
          id: "tool_error:details:block-1",
          source: "tool_error",
          label: "查看完整错误",
          action: { kind: "slash", command: "/details" },
        },
        {
          id: "setup:resume",
          source: "setup",
          label: "继续模型配置",
          action: { kind: "slash", command: "/model" },
        },
      ],
      taskSuggestionCursor: 0,
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    input.write("\x1b[B");
    await shell.waitUntilRenderFlush();
    expect(events).toContainEqual({ type: "task-suggestion-move", delta: 1 });

    view = { ...view, taskSuggestionCursor: 1 };
    shell.rerender();
    await shell.waitUntilRenderFlush();
    input.write("\r");
    await shell.waitUntilRenderFlush();
    expect(events).toContainEqual({
      type: "task-suggestion-action",
      suggestionId: "setup:resume",
    });

    shell.unmount();
  });

  it("Esc interrupts a busy task when no overlay owner is active", async () => {
    const view: ShellViewModel = {
      ...baseTaskView(),
      commandPanel: undefined,
      composer: {
        ...baseTaskView().composer,
        busy: true,
      },
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    await writeInput(input, shell, "\x1b");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await shell.waitUntilRenderFlush();

    expect(events).toContainEqual({ type: "interrupt" });
    expect(events).not.toContainEqual({ type: "escape" });
    shell.unmount();
  });

  it("keeps empty composer number input as text instead of globally selecting suggestions", async () => {
    const view: ShellViewModel = {
      ...baseTaskView(),
      commandPanel: undefined,
      taskSuggestions: [
        {
          id: "tool_error:details:block-1",
          source: "tool_error",
          label: "查看完整错误",
          action: { kind: "slash", command: "/details" },
        },
      ],
      taskSuggestionCursor: 0,
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    input.write("1");
    await shell.waitUntilRenderFlush();
    input.write("\r");
    await shell.waitUntilRenderFlush();

    expect(events).toContainEqual({ type: "submit", text: "1" });
    expect(events).not.toContainEqual({
      type: "task-suggestion-action",
      suggestionId: "tool_error:details:block-1",
    });

    shell.unmount();
  });

  it("routes HelpPanel numeric shortcuts directly to the selected entry", async () => {
    const view: ShellViewModel = {
      ...baseTaskView(),
      commandPanel: undefined,
      helpPanel: {
        group: "core",
        cursor: 0,
        scrollOffset: 0,
        entries: [
          { slash: "/help", description: "Help" },
          { slash: "/model", description: "Model" },
          { slash: "/sessions", description: "Sessions" },
        ],
      },
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    input.write("3");
    await shell.waitUntilRenderFlush();

    expect(events).toContainEqual({ type: "help-select", index: 2 });
    expect(events).not.toContainEqual({ type: "help-move", delta: 1 });
    expect(events).not.toContainEqual({ type: "help-enter" });
    shell.unmount();
  });

  it("keeps fallback newline keys in the editor while ordinary Enter submits", async () => {
    const view: ShellViewModel = {
      ...baseTaskView(),
      commandPanel: undefined,
      activity: undefined,
      blocks: [],
      taskSuggestions: undefined,
    };

    async function expectSubmit(values: string[], expected: string): Promise<void> {
      const { input, events, shell } = await renderWithEvents(() => view);
      for (const value of values) {
        await writeInput(input, shell, value);
      }
      expect(events).toContainEqual({ type: "submit", text: expected });
      shell.unmount();
    }

    await expectSubmit([..."plain", "\r"], "plain");
    await expectSubmit([..."foo\\", "\r", ..."bar", "\r"], "foo\nbar");
    await expectSubmit([..."baz", "\x0a", ..."qux", "\r"], "baz\nqux");
  });

  it("keeps Ctrl+J newline when slash suggestions are visible", async () => {
    const view: ShellViewModel = {
      ...baseTaskView(),
      commandPanel: undefined,
      activity: undefined,
      blocks: [],
      taskSuggestions: undefined,
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    for (const value of ["/", "h", "\x0a", ..."body", "\r"]) {
      await writeInput(input, shell, value);
    }

    expect(events).toContainEqual({ type: "submit", text: "/h\nbody" });
    expect(events).not.toContainEqual({ type: "submit", text: "/h" });
    shell.unmount();
  });

  it("shows slash suggestions after typing bare slash in the native bottom frame", async () => {
    let composerOverlayRows = 0;
    let composerDraftText = "";
    const view = (): ShellViewModel => ({
      ...baseTaskView(),
      composer: { ...baseTaskView().composer, draftText: composerDraftText },
      commandPanel: undefined,
      activity: undefined,
      blocks: [],
      taskSuggestions: undefined,
      composerOverlayRows,
    });
    const input = createTtyInput();
    const output = new TestTtyOutput();
    const events: ShellInputEvent[] = [];
    let shell: ReturnType<typeof renderInkShell>;
    const controller: ShellController = {
      getViewModel: view,
      onInput: (event) => {
        events.push(event);
        if (event.type === "composer-draft-change") {
          composerDraftText = event.text;
        }
        if (event.type === "composer-overlay-rows-change") {
          composerOverlayRows = event.rows;
          shell?.rerender();
        }
      },
    };
    shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();

    await writeInput(input, shell, "/");

    const visible = finalScreenLinesFrom(output, view().height).join("\n");
    const singleColumnRows = Math.min(getCoreSlashCandidates().length + 1, 7);
    const overlayEvent = events
      .filter((event) => event.type === "composer-overlay-rows-change")
      .at(-1);
    expect(visible).toContain("/model");
    expect(visible).toContain("/mode");
    expect(overlayEvent).toBeDefined();
    expect(overlayEvent?.type === "composer-overlay-rows-change" ? overlayEvent.rows : 0).toBe(
      singleColumnRows,
    );
    shell.unmount();
  });

  it("keeps wheel active but suppresses click selection when LINGHUN_TUI_MOUSE_SELECTION=0", async () => {
    vi.stubEnv("LINGHUN_TUI_MOUSE_SELECTION", "0");
    const view = {
      ...baseTaskView(),
      commandPanel: undefined,
      transcriptViewportGeometry: {
        x: 0,
        y: 2,
        width: 80,
        height: 8,
        contentHeight: 40,
        topOffset: 20,
      },
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    // Mouse press/drag/release should NOT produce transcript-mouse events
    await writeInput(input, shell, "\x1b[<0;10;5M");
    await writeInput(input, shell, "\x1b[<32;12;6M");
    await writeInput(input, shell, "\x1b[<0;12;6m");

    expect(events.some((event) => event.type === "transcript-mouse")).toBe(false);

    shell.unmount();
  });

  it("keeps Delete flowing to the editor instead of keybinding chord pending", async () => {
    const view: ShellViewModel = {
      ...baseTaskView(),
      commandPanel: undefined,
      activity: undefined,
      blocks: [],
      taskSuggestions: undefined,
    };
    const { input, events, shell } = await renderWithEvents(() => view);

    for (const value of [..."abc", "\x1b[D", "\x1b[3~", "\r"]) {
      await writeInput(input, shell, value);
    }

    expect(events).toContainEqual({ type: "submit", text: "ab" });
    shell.unmount();
  });
});
