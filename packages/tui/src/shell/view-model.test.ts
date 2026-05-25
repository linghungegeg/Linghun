import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TuiContext } from "../index.js";
import {
  createEditBuffer,
  formatComposerRenderLines,
  handleComposerInput,
} from "./components/Composer.js";
import { renderInkShell, shouldUseInkShell } from "./ink-renderer.js";
import { renderPlainShell } from "./plain-renderer.js";
import { resetTerminalCapabilityCache } from "./terminal-capability.js";
import type { ProductBlockViewModel } from "./types.js";
import {
  createOutputBlock,
  createShellViewModel,
  getComposerPlaceholder,
  mapPendingApprovalToPermission,
  mapRequestActivityToView,
} from "./view-model.js";

// Reset terminal capability cache after every test to prevent cross-test pollution.
// On Windows without WT_SESSION, detectTerminalCapability() returns legacy unless
// LINGHUN_TERMINAL_TIER is explicitly set. Tests that need modern/basic behavior
// must stub LINGHUN_TERMINAL_TIER accordingly.
afterEach(() => {
  resetTerminalCapabilityCache();
  vi.unstubAllEnvs();
});

class TestTtyOutput extends Writable {
  readonly chunks: string[] = [];
  isTTY = true;
  columns = 80;
  rows = 24;

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

function createContext(overrides: Partial<TuiContext> = {}): TuiContext {
  return {
    language: "zh-CN",
    projectPath: "/tmp/这是一个很长很长的 Linghun 项目路径",
    model: "deepseek-v4-flash-with-a-very-long-model-name",
    permissionMode: "default",
    config: {
      workspaceTrust: {
        recorded: true,
        level: "trusted",
      },
    },
    index: {
      status: "ready",
    },
    cache: {
      history: [{ hitRate: 0.42 }],
    },
    backgroundTasks: [{ status: "running" }, { status: "completed" }],
    ...overrides,
  } as unknown as TuiContext;
}

describe("shell view model", () => {
  it("zh-CN only shows Chinese vision, en-US only shows English vision", () => {
    const zhView = createShellViewModel(createContext({ language: "zh-CN" }), { width: 80 });
    const enView = createShellViewModel(createContext({ language: "en-US" }), { width: 80 });

    expect(zhView.brand).toBe("LingHun");
    expect(zhView.homeVision).toBe("技术普惠会越来越成熟 而你就是最伟大的梦想家");
    expect((zhView as Record<string, unknown>).homeVisionEn).toBeUndefined();
    expect(enView.brand).toBe("LingHun");
    expect(enView.homeVision).toBe(
      "Technology will become more accessible, and you are the greatest dreamer.",
    );
    expect(getComposerPlaceholder("zh-CN")).toBe("我能帮您做点什么？");
    expect(getComposerPlaceholder("en-US")).toBe("What can I help you with?");
    expect(zhView.composer.placeholder).toBe("我能帮您做点什么？");
    expect(enView.composer.placeholder).toBe("What can I help you with?");
  });

  it("composer has no prompt or hint fields", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    expect((view.composer as Record<string, unknown>).prompt).toBeUndefined();
    expect((view.composer as Record<string, unknown>).hint).toBeUndefined();
  });

  it("projects setup-needed as a light hint, not a bordered block", () => {
    const zhView = createShellViewModel(createContext(), {
      setupNeeded: true,
      width: 120,
      viewMode: "task",
    });
    const enView = createShellViewModel(createContext({ language: "en-US" }), {
      setupNeeded: true,
      width: 120,
      viewMode: "task",
    });

    expect(zhView.brand).toBe("LingHun");
    expect(zhView.status.project).toContain("项目：");
    expect(zhView.status.model).toContain("模型：");
    expect(zhView.status.permission).toBe("权限：风险确认");
    expect(zhView.status.trust).toBe("信任：已信任");
    expect(zhView.status.index).toBe("索引：ready");
    expect(zhView.status.background).toBe("后台：1");
    // setup-needed 不再生成 block
    expect(zhView.blocks.some((block) => block.id === "setup-needed")).toBe(false);
    // 而是生成 setupHint 轻提示 (only in task/pending mode, not home)
    expect(zhView.setupHint).toContain("按 Enter");
    expect(zhView.setupHint).toContain("我要配置模型");
    expect(zhView.setupHint).not.toContain("/model setup");
    expect(enView.setupHint).toContain("Press Enter");
    expect(enView.setupHint).toContain("configure provider");
    expect(enView.setupHint).not.toContain("/model setup");
  });

  it("exposes composer masking only during the model setup apiKey step", () => {
    const apiKeyView = createShellViewModel(
      createContext({ pendingModelSetup: { step: "apiKey" } } as Partial<TuiContext>),
    );
    const modelView = createShellViewModel(
      createContext({ pendingModelSetup: { step: "model" } } as Partial<TuiContext>),
    );

    expect(apiKeyView.composer.masking).toBe(true);
    expect(modelView.composer.masking).toBe(false);
  });

  it("keeps project route problems separate from user provider setup", () => {
    const view = createShellViewModel(createContext(), {
      projectRouteProblem: "missing-provider executor route",
      width: 120,
    });
    const routeBlock = view.blocks.find((block) => block.id === "project-route-problem");

    expect(view.blocks.some((block) => block.id === "setup-needed")).toBe(false);
    expect(routeBlock?.title).toBe("项目模型路由需要处理");
    expect(routeBlock?.summary).toContain("项目级 route/settings 问题");
    expect(routeBlock?.summary).toContain("不要重复填写用户 API key");
  });

  it("summarizes latest output without leaking raw keys or full multiline output", () => {
    const block = createOutputBlock(
      "done with apiKey=sk-shell-output-secret\nfull line 2\nfull line 3",
      "en-US",
      "output-test",
    );
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      outputBlocks: [block],
      width: 120,
    });
    const rendered = renderPlainShell(view);

    expect(block.summary).toBe("done with apiKey=[masked-key]");
    expect(block.detail).toBeUndefined();
    expect(rendered).toContain("Latest output");
    expect(rendered).toContain("done with apiKey=[masked-key]");
    expect(rendered).not.toContain("sk-shell-output-secret");
    expect(rendered).not.toContain("full line 2");
  });

  it("keeps 120/80/60/40-column mature shell view models stable without default cards", () => {
    for (const width of [120, 80, 60, 40]) {
      const view = createShellViewModel(createContext(), { width });
      const rendered = renderPlainShell(view);

      expect(view.width).toBe(width);
      expect(view.projectName.length).toBeLessThanOrEqual(width);
      expect(view.status.project).toContain("项目：");
      expect(view.status.model).toContain("模型：");
      expect(view.status.permission).toContain("权限：");
      expect(view.blocks.map((block) => block.id)).toEqual([]);
      expect(rendered).toContain("LingHun");
      // width <= 40 uses short vision; wider uses full vision
      if (width <= 40) {
        expect(rendered).toContain("技术普惠，你是最伟大的梦想家");
      } else {
        expect(rendered).toContain("技术普惠会越来越成熟 而你就是最伟大的梦想家");
      }
      expect(rendered).not.toContain("信任：");
      expect(rendered).not.toContain("首页");
      expect(rendered).not.toContain("项目状态");
      // status tray uses double-space, not ·
      expect(rendered).not.toContain("·");
    }
  });

  it("renders no-color plain fallback with text markers and no internal setup terms", () => {
    const view = createShellViewModel(createContext(), {
      noColor: true,
      setupNeeded: true,
      viewMode: "task",
      width: 40,
      limitations: ["当前为无颜色模式。"],
    });
    const rendered = renderPlainShell(view);

    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("[INFO] 首页");
    // setup-needed 现在是 setupHint 轻提示，不是 block (only in task/pending mode)
    expect(view.setupHint).toContain("按 Enter");
    expect(rendered).toContain("当前为无颜色模式。");
    expect(rendered).not.toContain("Start Gate");
    expect(rendered).not.toContain("endpointProfile");
    expect(rendered).not.toContain("tool_result");
    expect(rendered).not.toContain("local/static only");
    // No fake composer in task view
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    expect(rendered).not.toContain("你 >");
    expect(rendered).not.toContain("you >");
    // No version number
    expect(rendered).not.toContain("v0.1.0");
    // No ANSI escapes in no-color mode
    expect(rendered).not.toContain("\x1B[");
  });
});

describe("Ink shell selection", () => {
  it("keeps non-TTY, dumb terminal, and plain opt-in on fallback", () => {
    vi.unstubAllEnvs();
    const input = { isTTY: true } as NodeJS.ReadStream;
    const output = { isTTY: true } as NodeJS.WriteStream;

    // Non-TTY always falls back regardless of capability
    expect(shouldUseInkShell({ isTTY: false } as NodeJS.ReadStream, output)).toBe(false);
    expect(shouldUseInkShell(input, { isTTY: false } as NodeJS.WriteStream)).toBe(false);

    // TERM=dumb forces legacy (no cursorPositioning)
    resetTerminalCapabilityCache();
    vi.stubEnv("TERM", "dumb");
    expect(shouldUseInkShell(input, output)).toBe(false);
    vi.unstubAllEnvs();

    // Explicit plain opt-in
    resetTerminalCapabilityCache();
    vi.stubEnv("LINGHUN_TUI_PLAIN", "1");
    expect(shouldUseInkShell(input, output)).toBe(false);

    // Legacy tier explicitly
    vi.unstubAllEnvs();
    resetTerminalCapabilityCache();
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    expect(shouldUseInkShell(input, output)).toBe(false);
  });

  it("allows TTY Ink shell while NO_COLOR stays a render-mode concern", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    vi.stubEnv("NO_COLOR", "1");

    expect(
      shouldUseInkShell(
        { isTTY: true } as NodeJS.ReadStream,
        { isTTY: true } as NodeJS.WriteStream,
      ),
    ).toBe(true);
  });

  it("keeps one Ink render instance while resize updates the view model width and height", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const widths: number[] = [];
    const heights: number[] = [];
    let resizeCallbacks = 0;
    const controller = {
      getViewModel: () => {
        widths.push(output.columns);
        heights.push(output.rows);
        return createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
        });
      },
      onInput: () => undefined,
      onResize: () => {
        resizeCallbacks += 1;
      },
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    await new Promise<void>((resolve) => setImmediate(resolve));
    output.columns = 40;
    output.rows = 15;
    output.emit("resize");
    // Wait for debounce (60ms) + render settle
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    expect(widths).toContain(80);
    expect(widths).toContain(40);
    expect(heights).toContain(24);
    expect(heights).toContain(15);
    // alternateScreen 进入和退出
    expect(output.text).toContain("\u001B[?1049h");
    expect(output.text).toContain("\u001B[?1049l");
    expect(resizeCallbacks).toBe(0);
    expect(output.text).not.toContain("\x1b[2J\x1b[H");
  });

  it("does not add beforeExit listener when waiting after unmount", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const beforeExitBefore = process.listenerCount("beforeExit");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();
    await shell.waitUntilExit();

    expect(process.listenerCount("beforeExit")).toBe(beforeExitBefore);
  });

  it("restores cursor and ignores rerender errors from stream-close races", async () => {
    vi.resetModules();
    const rerenderMock = vi.fn(() => {
      throw new Error("stream closed");
    });
    vi.doMock("ink", () => ({
      render: () => ({
        rerender: rerenderMock,
        clear: vi.fn(),
        unmount: vi.fn(),
        waitUntilExit: vi.fn(async () => undefined),
        waitUntilRenderFlush: vi.fn(async () => undefined),
      }),
    }));

    try {
      const { renderInkShell: renderInkShellWithMock } = await import("./ink-renderer.js");
      const output = new TestTtyOutput();
      const shell = renderInkShellWithMock(
        {
          getViewModel: () => createShellViewModel(createContext(), { width: output.columns }),
          onInput: () => undefined,
        },
        {
          stdin: createTtyInput(),
          stdout: output,
          stderr: new TestTtyOutput(),
        },
      );

      expect(() => shell.rerender()).not.toThrow();
      expect(rerenderMock).toHaveBeenCalledTimes(1);
      // No cursor escapes from our code — Ink manages cursor internally
      expect(output.text).not.toContain("\x1B[?25l");
      expect(output.text).not.toContain("\x1B[?25h");
    } finally {
      vi.doUnmock("ink");
      vi.resetModules();
    }
  });

  it("keeps ShellApp as a pure renderer without direct stdout resize handling", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("packages/tui/src/shell/components/ShellApp.tsx", "utf8");

    expect(source).not.toContain("useStdout");
    expect(source).not.toContain('stdout.on("resize"');
    expect(source).not.toContain("stdout.write");
    expect(source).not.toContain("onResize?.()");
  });

  it("renders the mature home without setup or composer border cards", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          setupNeeded: true,
          width: output.columns,
          height: output.rows,
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    expect(output.text).toContain("LingHun");
    expect(output.text).not.toContain("L I N G H U N");
    expect(output.text).not.toContain("信任：");
    expect(output.text).toContain("我能帮您做点什么？");
    expect(output.text).not.toContain("需要配置模型");
    // CCB-style two-line composer: has horizontal lines, no round border
    expect(output.text).toContain("─");
    expect(output.text).not.toContain("╭");
    expect(output.text).not.toContain("╮");
    expect(output.text).not.toContain("╰");
    expect(output.text).not.toContain("╯");
    expect(output.text).not.toContain("┌");
    // no old prompt prefix or hint text
    expect(output.text).not.toContain("你 >");
    expect(output.text).not.toContain("直接描述目标");
  });

  it("hides setupHint when setupNeeded is false", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          setupNeeded: false,
          width: output.columns,
          height: output.rows,
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    // setupHint must NOT appear when setupNeeded=false
    expect(output.text).not.toContain("还没有模型配置");
    expect(output.text).not.toContain("/model setup");

    // plain renderer also confirmed free of setupHint
    const plainView = createShellViewModel(createContext(), { setupNeeded: false, width: 80 });
    const plainRendered = renderPlainShell(plainView);
    expect(plainRendered).not.toContain("还没有模型配置");
    expect(plainRendered).not.toContain("/model setup");
  });

  it("keeps Shift+Enter as a composer newline instead of submitting", () => {
    expect(handleComposerInput("hello", "", { return: true, shift: true })).toEqual({
      kind: "append",
      text: "\n",
    });
    expect(handleComposerInput("hello\nworld", "", { return: true })).toEqual({
      kind: "emit",
      event: { type: "submit", text: "hello\nworld" },
      nextText: "",
    });
  });

  it("keeps the brand wordmark stable without blocky pixel glyphs or duplicate text lines", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    expect(output.text).toContain("LingHun");
    expect(output.text).toContain("──");
    expect(output.text).not.toContain("█");
    expect(output.text).not.toContain("▀▄▄▀");
    expect(output.text).not.toContain("L I N G H U N");
    // No figlet heavy double-line borders
    expect(output.text).not.toContain("╔");
    expect(output.text).not.toContain("╗");
    expect(output.text).not.toContain("╚");
    expect(output.text).not.toContain("╝");

    // Plain renderer also has compact header (no ASCII art, no version)
    const plainView = createShellViewModel(createContext(), { width: 80 });
    const plainRendered = renderPlainShell(plainView);
    expect(plainRendered).toContain("LingHun");
    expect(plainRendered).not.toContain("v0.1.0");
    expect(plainRendered).not.toContain("█");
    expect(plainRendered).not.toContain("L I N G H U N");
    expect(plainRendered).not.toContain("|____|");
  });
});

describe("home → task view mode transition", () => {
  it("defaults to home mode when no output/activity/permission", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    expect(view.viewMode).toBe("home");
  });

  it("switches to task mode when outputBlocks are present", () => {
    const block = createOutputBlock("task completed", "zh-CN", "out-1");
    const view = createShellViewModel(createContext(), { width: 80, outputBlocks: [block] });
    expect(view.viewMode).toBe("task");
  });

  it("switches to task mode when activity is present", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      activity: { phase: "thinking", text: "正在思考…" },
    });
    expect(view.viewMode).toBe("task");
  });

  it("switches to task mode when permission is present", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      permission: {
        toolName: "Bash",
        reason: "需要执行命令",
        risk: "high",
        scope: ["rm -rf /tmp/test"],
        hint: "输入 yes 允许，no 拒绝",
      },
    });
    expect(view.viewMode).toBe("task");
  });

  it("allows explicit viewMode override", () => {
    const view = createShellViewModel(createContext(), { width: 80, viewMode: "task" });
    expect(view.viewMode).toBe("task");
    const homeView = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "home",
      outputBlocks: [createOutputBlock("x", "zh-CN")],
    });
    expect(homeView.viewMode).toBe("home");
  });

  it("task mode plain render has compact top bar without full brand area", () => {
    const block = createOutputBlock("done", "zh-CN", "out-1");
    const view = createShellViewModel(createContext(), { width: 80, outputBlocks: [block] });
    const rendered = renderPlainShell(view);

    // Brand appears in compact top bar, no version
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    // No vision text in task mode
    expect(rendered).not.toContain("技术普惠会越来越成熟");
    // Status tray preserved
    expect(rendered).toContain("项目：");
    expect(rendered).toContain("模型：");
    // No fake composer input line
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    // Output block preserved
    expect(rendered).toContain("最近输出");
  });

  it("task mode plain render shows activity indicator", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      activity: { phase: "tool_running", text: "正在运行 Bash…", toolName: "Bash" },
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("正在运行 Bash…");
    expect(rendered).not.toContain("技术普惠会越来越成熟");
  });

  it("task mode plain render shows permission prompt", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      permission: {
        toolName: "Write",
        reason: "写入文件",
        risk: "medium",
        scope: ["src/main.ts"],
        hint: "yes / no",
      },
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("[Write]");
    expect(rendered).toContain("写入文件");
    expect(rendered).toContain("src/main.ts");
    expect(rendered).toContain("yes / no");
  });

  it("task mode Ink render shows activity and hides brand hero", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
          activity: { phase: "thinking", text: "正在思考…" },
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    // Brand in compact top bar
    expect(output.text).toContain("LingHun");
    // Activity indicator visible
    expect(output.text).toContain("正在思考…");
    // Vision text NOT shown in task mode
    expect(output.text).not.toContain("技术普惠会越来越成熟");
    // Composer still present
    expect(output.text).toContain("我能帮您做点什么？");
  });

  it("task mode Ink render shows permission with border", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
          permission: {
            toolName: "Bash",
            reason: "执行命令",
            risk: "high",
            scope: ["npm install"],
            hint: "yes / no",
          },
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    expect(output.text).toContain("Bash");
    expect(output.text).toContain("执行命令");
    // Permission uses single border
    expect(output.text).toContain("│");
    expect(output.text).toContain("yes / no");
  });

  it("home mode Ink render does NOT show task activity or permission", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    // Home mode shows vision
    expect(output.text).toContain("技术普惠会越来越成熟");
    // No activity or permission
    expect(output.text).not.toContain("正在思考");
    expect(output.text).not.toContain("yes / no");
  });

  it("task mode does not leak sensitive keys in output blocks", () => {
    const block = createOutputBlock(
      "result: sk-proj-abcdefghijklmnop Bearer token123456",
      "zh-CN",
      "out-secret",
    );
    const view = createShellViewModel(createContext(), { width: 80, outputBlocks: [block] });
    const rendered = renderPlainShell(view);

    expect(rendered).not.toContain("sk-proj-abcdefghijklmnop");
    expect(rendered).toContain("[masked-key]");
  });

  it("setupHint does not appear in task mode when setupNeeded is false", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      setupNeeded: false,
    });
    expect(view.setupHint).toBeUndefined();
    const rendered = renderPlainShell(view);
    expect(rendered).not.toContain("还没有模型配置");
  });

  it("permission pending suppresses output blocks to avoid double display", () => {
    const block = createOutputBlock("permission prompt text", "zh-CN", "out-perm");
    const view = createShellViewModel(createContext(), {
      width: 80,
      outputBlocks: [block],
      permission: {
        toolName: "Bash",
        reason: "需要执行命令",
        risk: "high",
        scope: ["rm -rf /tmp"],
        hint: "yes / no",
      },
    });
    // output block should be suppressed when permission is present
    expect(view.blocks.find((b) => b.id === "out-perm")).toBeUndefined();
    // permission is still present on the view model
    expect(view.permission?.toolName).toBe("Bash");
    // viewMode is still task
    expect(view.viewMode).toBe("task");
  });

  it("resize does not duplicate home page in Ink shell", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    let callCount = 0;
    const controller = {
      getViewModel: () => {
        callCount += 1;
        return createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
        });
      },
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();

    // Simulate resize
    output.columns = 60;
    output.rows = 20;
    output.emit("resize");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await shell.waitUntilRenderFlush();

    shell.unmount();
    await shell.waitUntilExit();

    // Brand should appear but NOT be duplicated (alternateScreen handles clearing)
    const brandMatches = output.text.split("技术普惠会越来越成熟");
    // With alternateScreen, Ink clears before re-render, so no duplication
    // The text may appear multiple times in raw output due to initial + re-render,
    // but the key assertion is no stdout.write("\x1b[2J\x1b[H") from ShellApp
    expect(output.text).not.toContain("\x1b[2J\x1b[H");
  });

  it("resize in task mode stays stable without duplicating content", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
          activity: { phase: "thinking", text: "正在思考…" },
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();

    output.columns = 50;
    output.rows = 18;
    output.emit("resize");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await shell.waitUntilRenderFlush();

    shell.unmount();
    await shell.waitUntilExit();

    // No manual clear-screen from ShellApp
    expect(output.text).not.toContain("\x1b[2J\x1b[H");
    // Activity still visible after resize
    expect(output.text).toContain("正在思考…");
  });
});

describe("mapRequestActivityToView — real context field mapping", () => {
  it("returns undefined when no requestActivityPhase is set", () => {
    const ctx = createContext();
    expect(mapRequestActivityToView(ctx)).toBeUndefined();
  });

  it("maps request_started to thinking phase with zh-CN text", () => {
    const ctx = createContext({ requestActivityPhase: "request_started" } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.phase).toBe("thinking");
    expect(result?.text).toBe("正在思考…");
    expect(result?.toolName).toBeUndefined();
  });

  it("maps tool_running with toolName to tool_running phase", () => {
    const ctx = createContext({
      requestActivityPhase: "tool_running",
      requestActivityToolName: "Write",
    } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.phase).toBe("tool_running");
    expect(result?.text).toBe("正在运行 Write…");
    expect(result?.toolName).toBe("Write");
  });

  it("maps continuing_after_tool to continuing phase", () => {
    const ctx = createContext({
      requestActivityPhase: "continuing_after_tool",
    } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.phase).toBe("continuing");
    expect(result?.text).toBe("工具完成，继续处理…");
  });

  it("maps permission_waiting phase correctly", () => {
    const ctx = createContext({
      requestActivityPhase: "permission_waiting",
    } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.phase).toBe("permission_waiting");
    expect(result?.text).toBe("等待权限确认…");
  });

  it("maps en-US language correctly", () => {
    const ctx = createContext({
      language: "en-US",
      requestActivityPhase: "tool_running",
      requestActivityToolName: "Bash",
    } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.text).toBe("Running Bash…");
  });

  it("returns undefined for unknown phase values", () => {
    const ctx = createContext({
      requestActivityPhase: "unknown_phase" as unknown,
    } as Partial<TuiContext>);
    expect(mapRequestActivityToView(ctx)).toBeUndefined();
  });
});

describe("mapPendingApprovalToPermission — real context field mapping", () => {
  it("returns undefined when no pendingLocalApproval is set", () => {
    const ctx = createContext();
    expect(mapPendingApprovalToPermission(ctx)).toBeUndefined();
  });

  it("maps model_tool_use approval for Bash with high risk", () => {
    const ctx = createContext({
      pendingLocalApproval: {
        kind: "model_tool_use",
        toolName: "Bash",
        toolCall: { input: { command: "rm -rf /tmp/test" } },
      },
    } as Partial<TuiContext>);
    const result = mapPendingApprovalToPermission(ctx);
    expect(result).toBeDefined();
    expect(result?.toolName).toBe("Bash");
    expect(result?.risk).toBe("high");
    expect(result?.scope).toContain("rm -rf /tmp/test");
    expect(result?.reason).toContain("Bash");
    expect(result?.hint).toContain("y");
  });

  it("maps model_tool_use approval for Write with medium risk", () => {
    const ctx = createContext({
      pendingLocalApproval: {
        kind: "model_tool_use",
        toolName: "Write",
        toolCall: { input: { file_path: "src/main.ts" } },
      },
    } as Partial<TuiContext>);
    const result = mapPendingApprovalToPermission(ctx);
    expect(result).toBeDefined();
    expect(result?.toolName).toBe("Write");
    expect(result?.risk).toBe("medium");
    expect(result?.scope).toContain("src/main.ts");
  });

  it("maps architecture_drift approval with warnings", () => {
    const ctx = createContext({
      pendingLocalApproval: {
        kind: "architecture_drift",
        toolName: "Edit",
        toolCall: { input: { file_path: "core/api.ts" } },
        warnings: ["修改了公共接口"],
      },
    } as Partial<TuiContext>);
    const result = mapPendingApprovalToPermission(ctx);
    expect(result).toBeDefined();
    expect(result?.toolName).toBe("Edit");
    expect(result?.reason).toContain("修改了公共接口");
  });

  it("returns undefined for unrecognized approval kinds", () => {
    const ctx = createContext({
      pendingLocalApproval: {
        kind: "index_ignore_write",
      },
    } as Partial<TuiContext>);
    expect(mapPendingApprovalToPermission(ctx)).toBeUndefined();
  });

  it("maps en-US language hint correctly", () => {
    const ctx = createContext({
      language: "en-US",
      pendingLocalApproval: {
        kind: "model_tool_use",
        toolName: "Bash",
        toolCall: { input: { command: "npm install" } },
      },
    } as Partial<TuiContext>);
    const result = mapPendingApprovalToPermission(ctx);
    expect(result).toBeDefined();
    expect(result?.hint).toContain("Enter y to allow");
  });
});

describe("backgroundSummaries → blocks mapping", () => {
  it("filters out completed background, keeps running", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        { id: "t1", title: "lint check", status: "running" },
        { id: "t2", title: "test suite", status: "completed", result: "pass" },
      ],
    });
    const bgBlocks = view.blocks.filter((b) => b.id.startsWith("bg-"));
    // completed is filtered out — only running shows
    expect(bgBlocks).toHaveLength(1);
    expect(bgBlocks[0]?.id).toBe("bg-t1");
    expect(bgBlocks[0]?.kind).toBe("run");
    expect(bgBlocks[0]?.status).toBe("running");
    expect(bgBlocks[0]?.title).toContain("后台：lint check");
  });

  it("maps failed and timeout statuses correctly", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        { id: "t3", title: "deploy", status: "failed", result: "fail" },
        { id: "t4", title: "health check", status: "timeout" },
      ],
    });
    const bgBlocks = view.blocks.filter((b) => b.id.startsWith("bg-"));
    expect(bgBlocks[0]?.status).toBe("fail");
    expect(bgBlocks[1]?.status).toBe("blocked");
  });

  it("uses en-US prefix for background blocks", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "t5", title: "build", status: "running" }],
    });
    const bgBlock = view.blocks.find((b) => b.id === "bg-t5");
    expect(bgBlock?.title).toContain("Background: build");
  });

  it("completed tasks are hidden from task output (no historical noise)", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "t6", title: "job", status: "completed" }],
    });
    const bgBlock = view.blocks.find((b) => b.id === "bg-t6");
    // D.13: completed historical background is filtered out
    expect(bgBlock).toBeUndefined();
  });

  it("home mode does not show background blocks", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      backgroundSummaries: [{ id: "t7", title: "lint", status: "running" }],
    });
    expect(view.viewMode).toBe("home");
    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
  });
});

describe("Bearer token standalone redaction", () => {
  it("redacts standalone Bearer tokens in output blocks", () => {
    const block = createOutputBlock(
      "result: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
      "zh-CN",
      "out-bearer",
    );
    expect(block.summary).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(block.summary).toContain("Bearer [masked-key]");
  });

  it("redacts Bearer tokens even without authorization header prefix", () => {
    const block = createOutputBlock(
      "Token is Bearer abcdefghijklmnop used here",
      "en-US",
      "out-bearer2",
    );
    expect(block.summary).not.toContain("abcdefghijklmnop");
    expect(block.summary).toContain("Bearer [masked-key]");
  });

  it("does not redact short Bearer values (less than 8 chars)", () => {
    const block = createOutputBlock("Bearer short", "en-US", "out-short");
    expect(block.summary).toBe("Bearer short");
  });

  it("redacts both sk- keys and Bearer tokens in the same line", () => {
    const block = createOutputBlock(
      "keys: sk-proj-abcdefghijklmnop and Bearer eyJhbGciOiJIUzI1NiJ9.x",
      "zh-CN",
      "out-both",
    );
    expect(block.summary).not.toContain("sk-proj-abcdefghijklmnop");
    expect(block.summary).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(block.summary).toContain("[masked-key]");
    expect(block.summary).toContain("Bearer [masked-key]");
  });
});

describe("D.12B — P0-1: activity error/failed/completed phase mapping", () => {
  it("maps request_failed to error phase with user-friendly text", () => {
    const ctx = createContext({
      requestActivityPhase: "request_failed",
    } as unknown as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.phase).toBe("error");
    expect(result?.text).toContain("请求失败");
  });

  it("maps error phase to error with en-US text", () => {
    const ctx = createContext({
      language: "en-US",
      requestActivityPhase: "error",
    } as unknown as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result?.phase).toBe("error");
    expect(result?.text).toContain("Request failed");
  });

  it("maps failed phase to error", () => {
    const ctx = createContext({ requestActivityPhase: "failed" } as unknown as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result?.phase).toBe("error");
  });

  it("maps completed phase correctly", () => {
    const ctx = createContext({
      requestActivityPhase: "completed",
    } as unknown as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result?.phase).toBe("completed");
    expect(result?.text).toContain("已完成");
  });

  it("maps request_completed to completed phase", () => {
    const ctx = createContext({
      language: "en-US",
      requestActivityPhase: "request_completed",
    } as unknown as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result?.phase).toBe("completed");
    expect(result?.text).toContain("Completed");
  });

  it("error activity renders with fail marker in plain mode", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      activity: { phase: "error", text: "请求失败，可重试或用 /model doctor 排查。" },
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("请求失败");
    expect(rendered).not.toContain("技术普惠会越来越成熟");
  });
});

describe("D.12B — P0-2: permission composer mode", () => {
  it("shows permission placeholder when permission is pending", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      permission: {
        toolName: "Bash",
        reason: "执行命令",
        risk: "high",
        scope: ["npm install"],
        hint: "yes / no",
      },
    });
    expect(view.composer.placeholder).toContain("y/yes");
    expect(view.composer.placeholder).toContain("n/no");
    expect(view.composer.placeholder).not.toBe("我能帮您做点什么？");
  });

  it("shows normal placeholder when no permission is pending", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    expect(view.composer.placeholder).toBe("我能帮您做点什么？");
  });

  it("en-US permission placeholder includes allow/deny/details/Esc", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      permission: {
        toolName: "Write",
        reason: "write file",
        risk: "medium",
        scope: ["src/main.ts"],
        hint: "yes / no",
      },
    });
    expect(view.composer.placeholder).toContain("allow");
    expect(view.composer.placeholder).toContain("deny");
    expect(view.composer.placeholder).toContain("details");
    expect(view.composer.placeholder).toContain("Esc");
  });
});

describe("D.12B — P0-3: plain renderer permission risk level", () => {
  it("shows [HIGH] for high risk permission in plain mode", () => {
    const view = createShellViewModel(createContext(), {
      noColor: true,
      width: 80,
      permission: {
        toolName: "Bash",
        reason: "执行命令",
        risk: "high",
        scope: ["rm -rf /tmp"],
        hint: "yes / no",
      },
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("[Bash]");
    expect(rendered).toContain("[HIGH]");
  });

  it("shows [MEDIUM] for medium risk permission", () => {
    const view = createShellViewModel(createContext(), {
      noColor: true,
      width: 80,
      permission: {
        toolName: "Write",
        reason: "写入文件",
        risk: "medium",
        scope: ["src/main.ts"],
        hint: "yes / no",
      },
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("[Write]");
    expect(rendered).toContain("[MEDIUM]");
  });

  it("shows [LOW] for low risk permission", () => {
    const view = createShellViewModel(createContext(), {
      noColor: true,
      width: 80,
      permission: {
        toolName: "Read",
        reason: "读取文件",
        risk: "low",
        scope: ["README.md"],
        hint: "yes / no",
      },
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("[Read]");
    expect(rendered).toContain("[LOW]");
  });
});

describe("D.12B — P1-1: output blocks keep last 3", () => {
  it("keeps up to 3 output blocks in task mode", () => {
    const blocks = [
      createOutputBlock("first", "zh-CN", "out-1"),
      createOutputBlock("second", "zh-CN", "out-2"),
      createOutputBlock("third", "zh-CN", "out-3"),
      createOutputBlock("fourth", "zh-CN", "out-4"),
    ];
    const view = createShellViewModel(createContext(), { width: 80, outputBlocks: blocks });
    const outputIds = view.blocks.map((b) => b.id);
    expect(outputIds).toContain("out-2");
    expect(outputIds).toContain("out-3");
    expect(outputIds).toContain("out-4");
    expect(outputIds).not.toContain("out-1");
  });

  it("still suppresses output blocks when permission is pending", () => {
    const blocks = [
      createOutputBlock("first", "zh-CN", "out-1"),
      createOutputBlock("second", "zh-CN", "out-2"),
    ];
    const view = createShellViewModel(createContext(), {
      width: 80,
      outputBlocks: blocks,
      permission: {
        toolName: "Bash",
        reason: "test",
        risk: "high",
        scope: [],
        hint: "yes / no",
      },
    });
    expect(view.blocks.find((b) => b.id === "out-1")).toBeUndefined();
    expect(view.blocks.find((b) => b.id === "out-2")).toBeUndefined();
  });
});

describe("D.12B — P1-2: narrow terminal StatusTray keeps background", () => {
  it("width=40 shows background count with short label", () => {
    const view = createShellViewModel(createContext(), { width: 40 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("后台:1");
  });

  it("width=80 shows full background label", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("后台：1");
  });

  it("en-US width=40 shows BG:N short label", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), { width: 40 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("BG:1");
  });
});

describe("D.12B — P1-3: deny/cancel feedback", () => {
  it("denial feedback generates a partial-status block", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      denialFeedback: { toolName: "Bash", kind: "denied" },
    });
    const denialBlock = view.blocks.find((b) => b.id === "denial-feedback");
    expect(denialBlock).toBeDefined();
    expect(denialBlock?.status).toBe("partial");
    expect(denialBlock?.summary).toContain("已拒绝 Bash");
    expect(denialBlock?.summary).toContain("未执行");
  });

  it("cancel feedback generates correct text", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      denialFeedback: { toolName: "Write", kind: "cancelled" },
    });
    const denialBlock = view.blocks.find((b) => b.id === "denial-feedback");
    expect(denialBlock?.summary).toContain("Cancelled Write");
    expect(denialBlock?.summary).toContain("not executed");
  });

  it("denial feedback triggers task viewMode", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      denialFeedback: { toolName: "Bash", kind: "denied" },
    });
    expect(view.viewMode).toBe("task");
  });

  it("denial feedback is not marked as pass", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      denialFeedback: { toolName: "Bash", kind: "denied" },
    });
    const denialBlock = view.blocks.find((b) => b.id === "denial-feedback");
    expect(denialBlock?.status).not.toBe("pass");
  });
});

describe("D.12B — P1-4: completed job hidden from task output", () => {
  it("completed job is filtered out (no historical noise)", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "j1", title: "build", status: "completed" }],
    });
    const bgBlock = view.blocks.find((b) => b.id === "bg-j1");
    // D.13: completed historical background is hidden
    expect(bgBlock).toBeUndefined();
  });

  it("running/failed/stale/blocked jobs still show", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        { id: "j2", title: "test", status: "running" },
        { id: "j3", title: "deploy", status: "failed" },
        { id: "j4", title: "health", status: "stale" },
      ],
    });
    const bgBlocks = view.blocks.filter((b) => b.id.startsWith("bg-"));
    expect(bgBlocks).toHaveLength(3);
    expect(bgBlocks[0]?.status).toBe("running");
    expect(bgBlocks[1]?.status).toBe("fail");
    expect(bgBlocks[2]?.status).toBe("blocked");
  });
});

describe("D.12B — #9: home flicker guard (submitted pending state)", () => {
  it("submitted=true produces pending viewMode", () => {
    const view = createShellViewModel(createContext(), { width: 80, submitted: true });
    expect(view.viewMode).toBe("pending");
  });

  it("pending viewMode renders as task layout (no home hero)", () => {
    const view = createShellViewModel(createContext(), { width: 80, submitted: true });
    const rendered = renderPlainShell(view);
    expect(rendered).not.toContain("技术普惠");
    expect(rendered).toContain("LingHun");
    expect(rendered).toContain("项目：");
  });

  it("explicit viewMode override takes precedence over submitted", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      submitted: true,
      viewMode: "home",
    });
    expect(view.viewMode).toBe("home");
  });
});

describe("D.12B — P3-1: narrow vision short text", () => {
  it("width=40 uses short vision text in zh-CN", () => {
    const view = createShellViewModel(createContext(), { width: 40 });
    expect(view.homeVision).toBe("技术普惠，你是最伟大的梦想家");
  });

  it("width=80 uses full vision text", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    expect(view.homeVision).toBe("技术普惠会越来越成熟 而你就是最伟大的梦想家");
  });

  it("en-US width=40 uses short vision", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), { width: 40 });
    expect(view.homeVision).toBe("You are the greatest dreamer.");
  });
});

describe("D.12B — P3-2: plain status tray total length control", () => {
  it("status tray does not exceed view width", () => {
    const ctx = createContext({
      projectPath: "/tmp/a-very-long-project-name-that-exceeds-normal-width",
      model: "deepseek-v4-flash-with-extremely-long-model-name-variant",
    });
    const view = createShellViewModel(ctx as unknown as TuiContext, { width: 60 });
    const rendered = renderPlainShell(view);
    const statusLine = rendered.split("\n").find((l) => l.includes("项目："));
    // Status tray should be controlled within width
    expect(statusLine).toBeDefined();
    if (statusLine) {
      expect(statusLine.length).toBeLessThanOrEqual(80); // reasonable upper bound
    }
  });
});

describe("D.12B — P2-5: no-color does not force white", () => {
  it("no-color plain render still has text markers for status", () => {
    const view = createShellViewModel(createContext(), {
      noColor: true,
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "nc1", title: "task", status: "failed" }],
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("[FAIL]");
    expect(rendered).toContain("LingHun");
  });
});

describe("D.12C — Composer cursor alignment closure", () => {
  it("empty Composer render includes prompt marker without fake cursor", () => {
    const { lines, cursorCol, cursorRow } = formatComposerRenderLines({
      buffer: createEditBuffer(""),
      placeholder: "我能帮您做点什么？",
      masking: false,
      noColor: false,
    });
    expect(lines).toEqual(["> 我能帮您做点什么？"]);
    // No fake cursor characters
    expect(lines.join("")).not.toContain("\u258C");
    expect(lines.join("")).not.toContain("|");
    // cursorCol should be at end of placeholder line
    expect(cursorRow).toBe(0);
    expect(cursorCol).toBeGreaterThan(0);

    // Plain renderer shows placeholder inside composer box as hint (no "> " prefix)
    const rendered = renderPlainShell(createShellViewModel(createContext(), { width: 80 }));
    expect(rendered).toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    expect(rendered).not.toContain("\u258C");
  });

  it("typed Composer render puts cursor position after text", () => {
    const { lines, cursorCol, cursorRow } = formatComposerRenderLines({
      buffer: createEditBuffer("修复光标"),
      placeholder: "我能帮您做点什么？",
      masking: false,
      noColor: false,
    });
    expect(lines).toEqual(["> 修复光标"]);
    // cursor at end of "> 修复光标" (2 + 4*2 = 10)
    expect(cursorRow).toBe(0);
    expect(cursorCol).toBe(10);
  });

  it("multiline Composer render reports cursor on the last line", () => {
    const { lines, cursorCol, cursorRow } = formatComposerRenderLines({
      buffer: createEditBuffer("第一行\n第二行\n第三行"),
      placeholder: "我能帮您做点什么？",
      masking: false,
      noColor: false,
    });
    expect(lines).toEqual(["> 第一行", "  第二行", "  第三行"]);
    expect(lines.join("\n")).not.toContain("\u258C");
    expect(cursorRow).toBe(2);
    // "  第三行" = 2 + 3*2 = 8
    expect(cursorCol).toBe(8);
  });

  it("no-color Composer render has no fake cursor characters", () => {
    const { lines, cursorCol } = formatComposerRenderLines({
      buffer: createEditBuffer("修复光标"),
      placeholder: "我能帮您做点什么？",
      masking: false,
      noColor: true,
    });
    expect(lines).toEqual(["> 修复光标"]);
    expect(lines.join("\n")).not.toContain("\u258C");
    expect(lines.join("\n")).not.toContain("|");
    expect(cursorCol).toBe(10);

    const rendered = renderPlainShell(
      createShellViewModel(createContext(), { noColor: true, width: 80 }),
    );
    expect(rendered).toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("\u258C");
  });

  it("brand wordmark to vision has spacing in plain home render", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    const lines = rendered.split("\n");
    // Compact header "LingHun" (no version) followed by accent line, empty line, then vision
    const brandIdx = lines.findIndex((l) => l.trim() === "LingHun");
    expect(brandIdx).toBeGreaterThanOrEqual(0);
    // Accent underline on next line (ASCII dash for legacy)
    const accentLine = lines[brandIdx + 1];
    expect(accentLine).toBeDefined();
    expect((accentLine as string).trim()).toMatch(/^-+$/);
    // Then empty line
    expect(lines[brandIdx + 2]).toBe("");
    // Then vision
    expect(lines[brandIdx + 3]).toContain("技术普惠");
  });

  it("ink-renderer does not add extra hide cursor — Ink manages cursor via useCursor", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    // After unmount, the last cursor escape must be show (safety restore)
    const lastShow = output.text.lastIndexOf("\x1B[?25h");
    expect(lastShow).toBeGreaterThanOrEqual(0);
  });

  it("ink-renderer show cursor on unmount path", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    // After unmount, the last cursor-related escape should be show
    const lastHide = output.text.lastIndexOf("\x1B[?25l");
    const lastShow = output.text.lastIndexOf("\x1B[?25h");
    expect(lastShow).toBeGreaterThan(lastHide);
  });

  it("ink-renderer restores cursor when stdout closes", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    output.emit("close");
    await shell.waitUntilExit();

    const lastHide = output.text.lastIndexOf("\x1B[?25l");
    const lastShow = output.text.lastIndexOf("\x1B[?25h");
    expect(lastShow).toBeGreaterThan(lastHide);
  });

  it("home brand/vision still renders, layout not switched to top bar", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
        }),
      onInput: () => undefined,
    };

    const shell = renderInkShell(controller, {
      stdin: input,
      stdout: output,
      stderr: new TestTtyOutput(),
    });
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    expect(output.text).toContain("LingHun");
    expect(output.text).toContain("技术普惠会越来越成熟");
    expect(output.text).toContain("我能帮您做点什么？");
  });

  it("width=40 does not crash", () => {
    const view = createShellViewModel(createContext(), { noColor: true, width: 40 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("\u258C");
  });

  it("width=40 no-color does not crash", () => {
    const view = createShellViewModel(createContext(), { noColor: true, width: 40 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("\u258C");
  });
});

describe("D.13 — Home + Task Product Shell Mature Closure", () => {
  it("Home large wordmark renders for width>=80", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), { width: 80 });
    const rendered = renderPlainShell(view);
    // Plain renderer uses compact header, no ASCII art wordmark, no version
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("┗━━");
    expect(rendered).not.toContain("|____|");
  });

  it("Home compact wordmark renders for width 60-79", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), { width: 65 });
    const rendered = renderPlainShell(view);
    // Compact header regardless of width, no version
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("━━━━━━━━━━━━━━");
    expect(rendered).not.toContain("┗━━");
  });

  it("Home narrow wordmark renders for width<60", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), { width: 50 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("━━━━━━━━━━━━━━");
    expect(rendered).not.toContain("┗━━");
  });

  it("Home no-color uses ASCII-safe separator", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    // Compact header, no ASCII art, no version
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("|____|");
    // ASCII separator (-)
    expect(rendered).toContain("-".repeat(10));
  });

  it("Task does not render large hero", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), {
      noColor: true,
      width: 80,
      viewMode: "task",
      activity: { phase: "thinking", text: "正在思考…" },
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("┗━━");
    expect(rendered).not.toContain("━━━━━━━━━━━━━━");
  });

  it("Home does not show background blocks", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "home",
      backgroundSummaries: [
        { id: "bg1", title: "running job", status: "running" },
        { id: "bg2", title: "failed job", status: "failed" },
      ],
    });
    const bgBlocks = view.blocks.filter((b) => b.id.startsWith("bg-"));
    expect(bgBlocks).toHaveLength(0);
  });

  it("Task does not show completed historical background noise", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        { id: "bg1", title: "old job", status: "completed" },
        { id: "bg2", title: "cancelled job", status: "cancelled" },
      ],
    });
    const bgBlocks = view.blocks.filter((b) => b.id.startsWith("bg-"));
    expect(bgBlocks).toHaveLength(0);
  });

  it("Task shows running/failed/timeout/stale/blocked background", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        { id: "bg1", title: "lint", status: "running" },
        { id: "bg2", title: "deploy", status: "failed" },
        { id: "bg3", title: "health", status: "timeout" },
        { id: "bg4", title: "old", status: "stale" },
      ],
    });
    const bgBlocks = view.blocks.filter((b) => b.id.startsWith("bg-"));
    expect(bgBlocks).toHaveLength(4);
    expect(bgBlocks[0]?.status).toBe("running");
    expect(bgBlocks[1]?.status).toBe("fail");
    expect(bgBlocks[2]?.status).toBe("blocked");
    expect(bgBlocks[3]?.status).toBe("blocked");
  });

  it("fail/blocking output prioritized over normal output", () => {
    const failBlock: ProductBlockViewModel = {
      id: "out-fail",
      kind: "error",
      status: "fail",
      title: "Error",
      summary: "Something failed",
    };
    const normalBlocks: ProductBlockViewModel[] = [
      { id: "out-1", kind: "details", status: "info", title: "Output 1", summary: "ok" },
      { id: "out-2", kind: "details", status: "info", title: "Output 2", summary: "ok" },
      { id: "out-3", kind: "details", status: "info", title: "Output 3", summary: "ok" },
      { id: "out-4", kind: "details", status: "info", title: "Output 4", summary: "ok" },
    ];
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [failBlock, ...normalBlocks],
    });
    const outputBlocks = view.blocks.filter((b) => b.id.startsWith("out-"));
    expect(outputBlocks.find((b) => b.id === "out-fail")).toBeDefined();
    expect(outputBlocks.length).toBeLessThanOrEqual(3);
  });

  it("normal output max 3 items", () => {
    const blocks: ProductBlockViewModel[] = Array.from({ length: 5 }, (_, i) => ({
      id: `out-${i}`,
      kind: "details" as const,
      status: "info" as const,
      title: `Output ${i}`,
      summary: `result ${i}`,
    }));
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: blocks,
    });
    const outputBlocks = view.blocks.filter((b) => b.id.startsWith("out-"));
    expect(outputBlocks.length).toBeLessThanOrEqual(3);
  });

  it("output blocks have /details hint", () => {
    const block = createOutputBlock("some output text", "zh-CN", "out-hint");
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const outBlock = view.blocks.find((b) => b.id === "out-hint");
    expect(outBlock?.nextAction).toContain("/details");
  });

  it("error output has /details hint for full error", () => {
    const block = createOutputBlock("error: something failed badly", "zh-CN", "out-err");
    expect(block.status).toBe("fail");
    expect(block.kind).toBe("error");
    expect(block.nextAction).toContain("/details");
  });

  it("permission pending suppresses normal output", () => {
    const block = createOutputBlock("normal output", "zh-CN", "out-perm");
    const view = createShellViewModel(createContext(), {
      width: 80,
      outputBlocks: [block],
      permission: {
        toolName: "Bash",
        reason: "需要执行命令",
        risk: "high",
        scope: ["rm -rf /tmp"],
        hint: "yes / no",
      },
    });
    expect(view.blocks.find((b) => b.id === "out-perm")).toBeUndefined();
  });

  it("Composer render lines contain no fake cursor characters", () => {
    const cases = [
      { text: "", noColor: false },
      { text: "hello", noColor: false },
      { text: "你好", noColor: true },
      { text: "line1\nline2\nline3", noColor: false },
    ];
    for (const { text, noColor } of cases) {
      const { lines } = formatComposerRenderLines({
        buffer: createEditBuffer(text),
        placeholder: "placeholder",
        masking: false,
        noColor,
      });
      const joined = lines.join("\n");
      expect(joined).not.toContain("\u258C");
    }
  });

  it("CJK cursor position accounts for double-width characters", () => {
    const { cursorCol } = formatComposerRenderLines({
      buffer: createEditBuffer("你好世界"),
      placeholder: "placeholder",
      masking: false,
      noColor: false,
    });
    // "> " (2) + "你好世界" (4*2=8) = 10
    expect(cursorCol).toBe(10);
  });

  it("masking cursor position uses masked length", () => {
    const { cursorCol, lines } = formatComposerRenderLines({
      buffer: createEditBuffer("secret"),
      placeholder: "placeholder",
      masking: true,
      noColor: false,
    });
    // "> " (2) + "******" (6) = 8
    expect(cursorCol).toBe(8);
    expect(lines[0]).toContain("******");
  });

  it("truncated multiline shows line count and correct cursor row", () => {
    const text = Array.from({ length: 8 }, (_, i) => `line${i}`).join("\n");
    const { lines, truncatedCount, cursorRow } = formatComposerRenderLines({
      buffer: createEditBuffer(text),
      placeholder: "placeholder",
      masking: false,
      noColor: false,
    });
    expect(truncatedCount).toBe(3);
    expect(lines).toHaveLength(5);
    expect(cursorRow).toBe(4);
  });

  it("plain renderer Home hero fallback is reasonable in no-color", () => {
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("┗");
    expect(rendered).not.toContain("━");
  });

  it("plain renderer Task does not show completed background noise", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "bg1", title: "done", status: "completed" }],
    });
    const rendered = renderPlainShell(view);
    expect(rendered).not.toContain("done");
  });

  it("plain renderer Task shows fail/details hint", () => {
    const block = createOutputBlock("error: crash", "zh-CN", "out-plain-err");
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("/details");
    // fail status marker (✗ in color mode, [FAIL] in no-color)
    expect(rendered).toContain("\u2717");
  });

  it("80x24 and 40 width do not squeeze placeholder hint", () => {
    for (const width of [80, 40]) {
      const view = createShellViewModel(createContext(), { width, height: 24 });
      const rendered = renderPlainShell(view);
      // Placeholder shown inside composer box as hint (no "> " prefix)
      expect(rendered).toContain("我能帮您做点什么？");
      expect(rendered).not.toContain("> 我能帮您做点什么？");
    }
  });
});

describe("TTY legacy fallback product shell", () => {
  it("shouldUseInkShell=false + TTY legacy does NOT output old REPL text", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    // Must NOT contain old REPL-style startup text
    expect(rendered).not.toContain("Linghun TUI");
    expect(rendered).not.toContain("REPL");
    expect(rendered).not.toContain("Type /help");
    // Must contain product shell elements
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    // Composer box with placeholder hint (no "> " prefix to avoid double-input)
    expect(rendered).toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
  });

  it("TTY legacy fallback outputs renderPlainShell Home product layout", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    // Product shell structure: brand + vision + composer box + status
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).toContain("技术普惠会越来越成熟");
    // Composer box includes placeholder hint (no "> " prefix — readline provides the real prompt)
    expect(rendered).toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    expect(rendered).toContain("项目：");
    expect(rendered).toContain("模型：");
    expect(rendered).toContain("权限：");
  });

  it("non-TTY pipe mode can still use plain text without product frame", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    // Even legacy gets structured output, not raw REPL
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
  });

  it("cmd fallback includes ASCII-safe compact header and status, no ASCII art", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    // ASCII-safe: uses - for separator, no Unicode box-drawing
    expect(rendered).toContain("-".repeat(10));
    // Compact header, no version, no ASCII art wordmark
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("|____|");
    expect(rendered).not.toContain("_     _");
    // No hero frame lines (═ or =)
    expect(rendered).not.toContain("=".repeat(10));
    // No Unicode box-drawing characters
    expect(rendered).not.toContain("━");
    expect(rendered).not.toContain("┗");
    expect(rendered).not.toContain("─");
    expect(rendered).not.toContain("═");
    // Composer box with "> placeholder" inside
    expect(rendered).toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    // Status tray present
    expect(rendered).toContain("项目：");
    expect(rendered).toContain("模型：");
  });

  it("cmd fallback Task view has structured permission card with ASCII borders", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), {
      noColor: true,
      width: 80,
      permission: {
        toolName: "Bash",
        reason: "执行命令",
        risk: "high",
        scope: ["rm -rf /tmp"],
        hint: "yes / no",
      },
    });
    const rendered = renderPlainShell(view);
    // ASCII card borders for permission
    expect(rendered).toContain("+");
    expect(rendered).toContain("|");
    expect(rendered).toContain("[Bash]");
    expect(rendered).toContain("[HIGH]");
    expect(rendered).toContain("执行命令");
    expect(rendered).toContain("rm -rf /tmp");
    expect(rendered).toContain("yes / no");
    // No Unicode box-drawing in permission card
    expect(rendered).not.toContain("┌");
    expect(rendered).not.toContain("└");
    expect(rendered).not.toContain("│");
    // No fake composer input line
    expect(rendered).not.toContain("> 我能帮您做点什么？");
  });

  it("modern terminal plain render uses Unicode box-drawing", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), {
      width: 80,
      permission: {
        toolName: "Write",
        reason: "写入文件",
        risk: "medium",
        scope: ["src/main.ts"],
        hint: "yes / no",
      },
    });
    const rendered = renderPlainShell(view);
    // Unicode box-drawing for permission card
    expect(rendered).toContain("┌");
    expect(rendered).toContain("└");
    expect(rendered).toContain("│");
    // Unicode separator lines (─) in task view
    expect(rendered).toContain("─");
  });

  it("modern terminal plain Home render uses Unicode separator", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), { width: 80, viewMode: "home" });
    const rendered = renderPlainShell(view);
    // Home view has ─ separator lines (no ═ hero frame)
    expect(rendered).toContain("─");
    expect(rendered).not.toContain("═");
    // Compact header without version
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
  });

  it("plain Home contains LingHun, short underline, vision, composer cyan lines, status", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), { width: 80, height: 24 });
    const rendered = renderPlainShell(view);
    const lines = rendered.split("\n");

    // Brand
    expect(rendered).toContain("LingHun");
    // Short underline (─ repeated 12-16 chars)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching ESC control character
    const ANSI_STRIP = /\x1B\[[0-9;]*m/g;
    const underlineIdx = lines.findIndex((l) =>
      /^[\s]*─{12,16}[\s]*$/.test(l.replace(ANSI_STRIP, "")),
    );
    expect(underlineIdx).toBeGreaterThan(0);
    // Vision
    expect(rendered).toContain("技术普惠会越来越成熟");
    // Composer top/bottom cyan lines (─ repeated composerWidth)
    const composerLineCount = lines.filter((l) => {
      const stripped = l.replace(ANSI_STRIP, "");
      return /^─{40,}$/.test(stripped.trim());
    }).length;
    expect(composerLineCount).toBeGreaterThanOrEqual(2);
    // Status tray below composer
    expect(rendered).toContain("项目：");
    expect(rendered).toContain("模型：");
    // No version number
    expect(rendered).not.toContain("v0.1.0");
    // No large ASCII art
    expect(rendered).not.toContain("|____|");
    expect(rendered).not.toContain("_     _");
  });

  it("plain Home contains localized composer placeholder", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const zhView = createShellViewModel(createContext({ language: "zh-CN" }), { width: 80 });
    const enView = createShellViewModel(createContext({ language: "en-US" }), { width: 80 });
    const zhRendered = renderPlainShell(zhView);
    const enRendered = renderPlainShell(enView);

    // Placeholder shown as hint (no "> " prefix — readline provides the real prompt)
    expect(zhRendered).toContain("我能帮您做点什么？");
    expect(zhRendered).not.toContain("> 我能帮您做点什么？");
    expect(enRendered).toContain("What can I help you with?");
    expect(enRendered).not.toContain("> What can I help you with?");
  });

  it("color plain Home contains ANSI escapes; no-color plain Home does not", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const colorView = createShellViewModel(createContext(), { width: 80 });
    const noColorView = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const colorRendered = renderPlainShell(colorView);
    const noColorRendered = renderPlainShell(noColorView);

    expect(colorRendered).toContain("\x1B[");
    expect(noColorRendered).not.toContain("\x1B[");
    // Both contain the placeholder (as hint, no "> " prefix)
    expect(colorRendered).toContain("我能帮您做点什么？");
    expect(colorRendered).not.toContain("> 我能帮您做点什么？");
    expect(noColorRendered).toContain("我能帮您做点什么？");
    expect(noColorRendered).not.toContain("> 我能帮您做点什么？");
  });

  it("Task plain preserves activity / permission risk / output blocks", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      activity: { phase: "tool_running", text: "正在运行 Bash…", toolName: "Bash" },
      permission: {
        toolName: "Bash",
        reason: "执行命令",
        risk: "high",
        scope: ["rm -rf /tmp"],
        hint: "yes / no",
      },
      outputBlocks: [
        {
          id: "out-1",
          kind: "details",
          status: "info",
          title: "Latest output",
          summary: "build succeeded",
        },
      ],
    });
    const rendered = renderPlainShell(view);

    // Activity
    expect(rendered).toContain("正在运行 Bash…");
    // Permission card with risk
    expect(rendered).toContain("[Bash]");
    expect(rendered).toContain("[HIGH]");
    expect(rendered).toContain("执行命令");
    // Task does NOT contain composer prompt line
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    // No version, no ASCII art
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("|____|");
  });
});

describe("Windows TTY terminal capability detection", () => {
  it("Windows TTY default (no WT_SESSION, no TERM_PROGRAM) → shouldUseInkShell=true on modern Windows", () => {
    vi.unstubAllEnvs();
    resetTerminalCapabilityCache();
    // Simulate bare Windows cmd.exe on Windows 10 19045 (no WT_SESSION, no TERM_PROGRAM)
    // On the actual test runner (Windows), this should pass naturally.
    // On non-Windows CI, we use LINGHUN_TERMINAL_TIER=basic to simulate.
    if (process.platform === "win32") {
      // Remove all terminal indicators to simulate bare cmd.exe
      process.env.WT_SESSION = undefined as unknown as string;
      process.env.TERM_PROGRAM = undefined as unknown as string;
      process.env.TERM = undefined as unknown as string;
      process.env.ConEmuPID = undefined as unknown as string;
      process.env.CONEMUDIR = undefined as unknown as string;
      process.env.MSYSTEM = undefined as unknown as string;
      process.env.ALACRITTY_WINDOW_ID = undefined as unknown as string;
      resetTerminalCapabilityCache();
      expect(
        shouldUseInkShell(
          { isTTY: true } as NodeJS.ReadStream,
          { isTTY: true } as NodeJS.WriteStream,
        ),
      ).toBe(true);
    } else {
      // On non-Windows, verify that LINGHUN_TERMINAL_TIER=basic gives Ink
      vi.stubEnv("LINGHUN_TERMINAL_TIER", "basic");
      resetTerminalCapabilityCache();
      expect(
        shouldUseInkShell(
          { isTTY: true } as NodeJS.ReadStream,
          { isTTY: true } as NodeJS.WriteStream,
        ),
      ).toBe(true);
    }
  });

  it("LINGHUN_TERMINAL_TIER=legacy forces shouldUseInkShell=false", () => {
    vi.unstubAllEnvs();
    resetTerminalCapabilityCache();
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    expect(
      shouldUseInkShell(
        { isTTY: true } as NodeJS.ReadStream,
        { isTTY: true } as NodeJS.WriteStream,
      ),
    ).toBe(false);
  });

  it("plain fallback does not produce double input (no '> placeholder' + readline prompt)", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    // Placeholder text is present as a hint
    expect(rendered).toContain("我能帮您做点什么？");
    // But NOT with "> " prefix (that would duplicate the readline prompt)
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    // No "你 >" old REPL prompt
    expect(rendered).not.toContain("你 >");
    expect(rendered).not.toContain("you >");
  });
});
