import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInkShell } from "./ink-renderer.js";
import { resetTerminalCapabilityCache } from "./terminal-capability.js";
import type { ShellController, ShellInputEvent, ShellViewModel } from "./types.js";

class TestTtyOutput extends Writable {
  readonly chunks: string[] = [];
  isTTY = true;
  columns = 100;
  rows = 28;

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

describe("Ink TTY interaction smoke", () => {
  afterEach(() => {
    resetTerminalCapabilityCache();
    vi.unstubAllEnvs();
  });

  it("drives CommandPanel, Ctrl+O, task scroll, footer, and permission focus through TTY keys", async () => {
    let view = baseTaskView();
    const { input, output, events, shell } = await renderWithEvents(() => view);

    expect(output.text).toContain("索引 ready");
    expect(output.text).toContain("gpt-5.5");

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

  it("keeps default main-screen SGR wheel and left selection native", async () => {
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

    await writeInput(input, shell, "\x1b[<64;10;5M");
    await writeInput(input, shell, "\x1b[<65;10;5M");
    await writeInput(input, shell, "\x1b[<65;10;20M");
    await writeInput(input, shell, "\x1b[<0;10;5M");
    await writeInput(input, shell, "\x1b[<32;12;6M");
    await writeInput(input, shell, "\x1b[<0;12;6m");

    expect(events).not.toContainEqual({ type: "transcript-scroll", action: "wheelUp" });
    expect(events).not.toContainEqual({ type: "transcript-scroll", action: "wheelDown" });
    expect(events.some((event) => event.type === "transcript-mouse")).toBe(false);

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
