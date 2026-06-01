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
    taskScroll: { scrollOffset: 0, stickToBottom: true, hasOverflow: true },
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
    input.write("\x1b[F");
    await shell.waitUntilRenderFlush();
    expect(events).toContainEqual({ type: "task-scroll", delta: 5 });
    expect(events).toContainEqual({ type: "task-scroll", delta: -5 });
    expect(events).toContainEqual({ type: "task-scroll-end" });

    input.write("\x1b");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await shell.waitUntilRenderFlush();
    expect(events).toContainEqual({ type: "command-panel-close" });

    const beforePermissionTyping = events.length;
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

    input.write("x");
    await shell.waitUntilRenderFlush();
    expect(events).toHaveLength(beforePermissionTyping);

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
});
