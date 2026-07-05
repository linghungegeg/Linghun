import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type TuiContext,
  __testBuildExplicitDetailsCommandPanel,
  __testCreateShellBlockOutput,
} from "../index.js";
import { formatToolOutput } from "../tool-output-presenter.js";
import {
  commitTerminalFirstUserBlock,
  createTerminalFirstAssistantSink,
} from "../tui-output-surface.js";
import {
  bufferInsert,
  bufferMoveDown,
  bufferMoveUp,
  composerCursorAnchorRowOffset,
  createEditBuffer,
  formatComposerRenderLines,
  handleComposerInput,
} from "./components/Composer.js";
import {
  __testSplitRawDiffSections,
  __testWrapInlineMarkdownRows,
  splitStreamingMarkdownForRender,
} from "./components/MessageMarkdown.js";
import { renderInkShell, resolveAlternateScreen, shouldUseInkShell } from "./ink-renderer.js";
import { renderPlainShell } from "./plain-renderer.js";
import { detectTerminalCapability, resetTerminalCapabilityCache } from "./terminal-capability.js";
import { displayWidth } from "./text-utils.js";
import type { ProductBlockViewModel } from "./types.js";
import {
  createTranscriptSource,
  upsertTranscriptSourceCell,
} from "./models/transcript-source.js";
import {
  createOutputBlock,
  createShellViewModel,
  computeRecentCacheHitRate,
  getComposerPlaceholder,
  mapBottomPaneStatusToView,
  mapPendingApprovalToPermission,
  mapRequestActivityToView,
} from "./view-model.js";

// Reset terminal capability cache after every test to prevent cross-test pollution.
// Tests that need a specific terminal tier should stub LINGHUN_TERMINAL_TIER
// explicitly; otherwise capability detection follows the host terminal.
afterEach(() => {
  resetTerminalCapabilityCache();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// Resolve src/ root from this test file's location so source-invariant
// assertions work regardless of vitest cwd (root run vs --filter run).
const __testDirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__testDirname, "..");

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

function createBackgroundTask(
  overrides: Partial<TuiContext["backgroundTasks"][number]> = {},
): TuiContext["backgroundTasks"][number] {
  return {
    id: "bg-test",
    kind: "agent",
    title: "background test",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    heartbeatIntervalMs: 1000,
    staleAfterMs: 5000,
    hasOutput: false,
    userVisibleSummary: "后台任务运行中",
    ...overrides,
  };
}

describe("shell view model", () => {
  it("keeps the home brand and localized composer placeholder without vision copy", () => {
    const zhView = createShellViewModel(createContext({ language: "zh-CN" }), { width: 80 });
    const enView = createShellViewModel(createContext({ language: "en-US" }), { width: 80 });

    expect(zhView.brand).toBe("LingHun");
    expect(zhView.homeVision).toBe("");
    expect((zhView as Record<string, unknown>).homeVisionEn).toBeUndefined();
    expect(enView.brand).toBe("LingHun");
    expect(enView.homeVision).toBe("");
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
    expect(zhView.status.permission).toBe("权限：默认模式");
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

  it("preserves multi-line assistant output while masking secrets", () => {
    // D.13Q-UX：assistant_text block 保留 fullText 多行（不打平到 summary 首行），
    // sk- 等敏感片段仍走 redactSensitiveText 掩盖。这是 D.13Q-UX 范式：
    // assistant 正文不再被 fitLine replace(/\s+/gu," ").trim() 打平。
    const block = createOutputBlock(
      "done with apiKey=sk-shell-output-secret\nfull line 2\nfull line 3",
      "en-US",
      "output-test",
    );
    const ctx = createContext({ language: "en-US" }) as TuiContext & {
      ctrlOExpandState?: { active: boolean; blockId?: string };
    };
    ctx.ctrlOExpandState = { active: true, blockId: "output-test" };
    const view = createShellViewModel(ctx, {
      outputBlocks: [block],
      width: 120,
    });
    const rendered = renderPlainShell(view);

    expect(block.summary).toBe("done with apiKey=[masked-key]\nfull line 2\nfull line 3");
    expect(block.detail).toBeUndefined();
    // D.13Q-UX assistant_text 在 plain 模式应保留所有多行正文。
    expect(block.messageKind).toBe("assistant_text");
    expect(rendered).toContain("done with apiKey=[masked-key]");
    expect(rendered).toContain("full line 2");
    expect(rendered).toContain("full line 3");
    // 敏感原值仍被 mask。
    expect(rendered).not.toContain("sk-shell-output-secret");
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
      expect(rendered).not.toContain("技术普惠");
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
    vi.stubEnv("LINGHUN_FULLSCREEN", "0");
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
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
    // Explicit fullscreen opt-out keeps this path in normal screen and clears
    // the live viewport before redraw.
    expect(output.text).not.toContain("\u001B[?1049h");
    expect(output.text).not.toContain("\u001B[?1049l");
    expect(resizeCallbacks).toBe(1);
    // Plan A append-only: task-mode resize clears only the bottom frame (cursor
    // to the frame anchor row + clear-to-end) instead of wiping the whole
    // screen, so native scrollback history above the frame is preserved.
    expect(output.text).toMatch(/\x1b\[\d+;1H\x1b\[J/);
    expect(output.text).not.toContain("\x1b[3J");
  });

  it("legacy normal-screen compatibility opt-out still clears viewport on resize", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    vi.stubEnv("LINGHUN_FULLSCREEN", "0");
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
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
    output.columns = 40;
    output.rows = 15;
    output.emit("resize");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await shell.waitUntilRenderFlush();
    shell.unmount();
    await shell.waitUntilExit();

    expect(output.text).not.toContain("\u001B[?1049h");
    expect(output.text).toContain("\x1b[2J\x1b[H");
    expect(output.text).not.toContain("\x1b[3J");
  });

  it("enables extended keyboard protocols and restores them on exit", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("WT_SESSION", "test-windows-terminal");
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

    expect(output.text).toContain("\x1B[>1u");
    expect(output.text).toContain("\x1B[<u");
    expect(output.text).toContain("\x1B[>4;2m");
    expect(output.text).toContain("\x1B[>4m");
    expect(output.text.indexOf("\x1B[>1u")).toBeLessThan(output.text.lastIndexOf("\x1B[<u"));
    expect(output.text.indexOf("\x1B[>4;2m")).toBeLessThan(output.text.lastIndexOf("\x1B[>4m"));
  });

  it("enables normal-screen wheel tracking and disables it on exit", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    vi.stubEnv("LINGHUN_FULLSCREEN", "0");
    vi.stubEnv("LINGHUN_TUI_MOUSE", "1");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () => createShellViewModel(createContext(), { width: output.columns }),
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

    expect(output.text).toContain("\x1B[?1000h");
    expect(output.text).toContain("\x1B[?1006h");
    expect(output.text).not.toContain("\x1B[?1002h");
    expect(output.text).not.toContain("\x1B[?1003h");
    expect(output.text).toContain("\x1B[?1006l");
    expect(output.text).toContain("\x1B[?1000l");
    expect(output.text).not.toContain("\x1B[?1007h");
  });

  it("default task shell uses the native bottom frame for scrollback coexist", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const controller = {
      getViewModel: () => createShellViewModel(createContext(), { width: output.columns }),
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

    expect(output.text).not.toContain("\x1B[?1049h");
    expect(output.text).not.toContain("\x1B[?1049l");
    expect(output.text).toMatch(/\x1B\[\d+;1H/u);
  });

  it("uses native scrollback by default and keeps alternate screen as explicit opt-out", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const capability = detectTerminalCapability();
    expect(resolveAlternateScreen(capability)).toBe(false);
    vi.stubEnv("LINGHUN_FULLSCREEN", "1");
    expect(resolveAlternateScreen(capability)).toBe(false);
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    expect(resolveAlternateScreen(capability)).toBe(false);
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    expect(resolveAlternateScreen(capability)).toBe(true);
    vi.stubEnv("LINGHUN_FULLSCREEN", "0");
    expect(resolveAlternateScreen(capability)).toBe(false);
  });

  it("keeps unsupported terminals and tmux out of alternate screen", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    expect(resolveAlternateScreen(detectTerminalCapability())).toBe(false);

    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    vi.stubEnv("TMUX_PANE", "%1");
    expect(resolveAlternateScreen(detectTerminalCapability())).toBe(false);
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
    vi.doMock("@linghun/ink-runtime", async () => {
      const actual =
        await vi.importActual<typeof import("@linghun/ink-runtime")>("@linghun/ink-runtime");
      return {
        ...actual,
        render: () => ({
          rerender: rerenderMock,
          clear: vi.fn(),
          unmount: vi.fn(),
          waitUntilExit: vi.fn(async () => undefined),
          waitUntilRenderFlush: vi.fn(async () => undefined),
        }),
      };
    });

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
      vi.doUnmock("@linghun/ink-runtime");
      vi.resetModules();
    }
  });

  it("keeps ShellApp as a pure renderer without direct stdout resize handling", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");

    expect(source).not.toContain("useStdout");
    expect(source).not.toContain('stdout.on("resize"');
    expect(source).not.toContain("stdout.write");
    expect(source).not.toContain("onResize?.()");
  });

  it("renders the task shell with the R2 round composer and without setup cards", async () => {
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

    expect(output.text).not.toContain("LingHun");
    expect(output.text).not.toContain("L I N G H U N");
    expect(output.text).not.toContain("信任：");
    expect(output.text).toContain("继续输入…");
    expect(output.text).toContain("继续模型配置");
    // No old-style REPL guidance
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

  it("inserts newline for explicit Shift+Enter while plain Enter still submits", () => {
    expect(handleComposerInput("hello", "\r", { return: true, shift: true })).toEqual({
      kind: "append",
      text: "\n",
    });
    expect(handleComposerInput("hello", "\x1B[13;2u", { return: false })).toEqual({
      kind: "append",
      text: "\n",
    });
    expect(handleComposerInput("hello\nworld", "", { return: true })).toEqual({
      kind: "emit",
      event: { type: "submit", text: "hello\nworld" },
      nextText: "",
    });
  });

  it("keeps the task composer stable without blocky pixel glyphs or duplicate text lines", async () => {
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

    expect(output.text).not.toContain("LingHun");
    // Composer prompt marker present without heavy box-drawing borders
    expect(output.text).toContain("›");
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

describe("task-only view mode", () => {
  it("defaults to task mode when no output/activity/permission", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    expect(view.viewMode).toBe("task");
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

  it("keeps task and pending as the only runtime layouts", () => {
    const view = createShellViewModel(createContext(), { width: 80, viewMode: "task" });
    expect(view.viewMode).toBe("task");
    const homeView = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "home",
      outputBlocks: [createOutputBlock("x", "zh-CN")],
    });
    expect(homeView.viewMode).toBe("task");
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
    // Task mode keeps the full StatusTray out of the top bar.
    expect(rendered).not.toContain("项目：");
    expect(rendered).not.toContain("模型：");
    // No fake composer input line
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    // Output block summary preserved (title is empty for non-fail per D13E-P3)
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

    // D.13D: task mode no longer renders the brand wordmark in a top bar.
    // Brand identity belongs to the home screen; task mode focuses on the
    // active flow, output, composer, and status footer.
    expect(output.text).not.toContain("LingHun");
    // Activity indicator visible
    expect(output.text).toContain("正在思考…");
    // Vision text NOT shown in task mode
    expect(output.text).not.toContain("技术普惠会越来越成熟");
    // Composer still present, with the task-mode placeholder
    expect(output.text).toContain("继续输入…");
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
            reason: "",
            risk: "high",
            scope: [],
            hint: "",
            actionSummary: "运行终端命令：npm install",
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

    expect(output.text).toContain("需要您授权");
    expect(output.text).toContain("运行终端命令：npm install");
    // Permission uses single border
    expect(output.text).toContain("│");
    expect(output.text).toContain("是");
    expect(output.text).toContain("允许以后这类 Bash 操作");
    expect(output.text).toContain("否");
    expect(output.text).toContain("详情");
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

    expect(output.text).not.toContain("技术普惠会越来越成熟");
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
    const ctx = createContext();
    ctx.streamingAssistant = {
      id: "assistant-active",
      text: "正在输出的 assistant preview",
      tailText: "正在输出的 assistant preview",
    };
    ctx.pendingLocalApproval = {
      kind: "model_tool_use",
      toolName: "Bash",
      sessionId: "test-session",
      toolCall: { id: "tool-1", name: "Bash", input: { command: "echo hi" } },
      resume: async () => undefined,
    } as NonNullable<TuiContext["pendingLocalApproval"]>;
    const view = createShellViewModel(ctx, {
      width: 80,
      outputBlocks: [block],
      activity: { phase: "tool_running", text: "正在执行工具…" },
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
    expect(view.streamingAssistantText).toBeUndefined();
    expect(view.activity).toMatchObject({ phase: "permission_waiting", toolName: "Bash" });
    expect(view.bottomPaneStatus).toMatchObject({
      kind: "action_required",
      source: "permission",
      text: "等待确认 · Bash",
    });
    expect(view.composer.busy).toBe(true);
    // viewMode is still task
    expect(view.viewMode).toBe("task");
  });

  it("resize does not duplicate home page in Ink shell", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
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

    expect(output.text).not.toContain("技术普惠会越来越成熟");
    expect(output.text).toContain("\x1b[?1049h");
    expect(output.text).toContain("\x1b[?1049l");
    expect(output.text).not.toContain("\x1b[3J");
  });

  it("resize in task mode stays stable without duplicating content", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
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

    // App-owned alternate screen is active; fallback viewport clearing is
    // covered by the source guard test below because Ink itself may clear
    // the alternate buffer while redrawing.
    expect(output.text).toContain("\x1b[?1049h");
    expect(output.text).toContain("\x1b[?1049l");
    expect(output.text).not.toContain("\x1b[3J");
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
    expect(result?.text).toBe("思考中…");
    expect(result?.toolName).toBeUndefined();
    expect(result?.language).toBe("zh-CN");
  });

  it("shows elapsed immediately for thinking activity", () => {
    const ctx = createContext({
      requestActivityPhase: "request_started",
      requestActivityStartedAt: Date.now(),
    } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result?.phase).toBe("thinking");
    expect(result?.elapsed).toBe("0s");
  });

  it("submitted fallback activity carries elapsed", () => {
    const view = createShellViewModel(createContext(), { submitted: true });
    expect(view.activity?.phase).toBe("thinking");
    expect(view.activity?.elapsed).toBeDefined();
  });

  it("submitted fallback activity uses stable submittedStartedAt for elapsed", () => {
    const startedAt = Date.now() - 12_000;
    const view = createShellViewModel(createContext(), {
      submitted: true,
      submittedStartedAt: startedAt,
    });
    expect(view.activity?.phase).toBe("thinking");
    expect(view.activity?.elapsed).toBe("12s");
  });

  it("maps tool_running with toolName to tool_running phase", () => {
    const startedAt = Date.now() - 65_000;
    const ctx = createContext({
      requestActivityPhase: "tool_running",
      requestActivityToolName: "Write",
      requestActivityStartedAt: startedAt,
    } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.phase).toBe("tool_running");
    expect(result?.text).toBe("运行 Write…");
    expect(result?.toolName).toBe("Write");
    expect(result?.elapsed).toBe("1m05s");
  });

  it("does not show elapsed for completed/error activity", () => {
    const startedAt = Date.now() - 65_000;
    const completed = mapRequestActivityToView(
      createContext({
        requestActivityPhase: "completed",
        requestActivityStartedAt: startedAt,
      } as unknown as Partial<TuiContext>),
    );
    const failed = mapRequestActivityToView(
      createContext({
        requestActivityPhase: "request_failed",
        requestActivityStartedAt: startedAt,
      } as unknown as Partial<TuiContext>),
    );
    expect(completed?.elapsed).toBeUndefined();
    expect(failed?.elapsed).toBeUndefined();
  });

  it("maps continuing_after_tool to continuing phase", () => {
    const ctx = createContext({
      requestActivityPhase: "continuing_after_tool",
    } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.phase).toBe("continuing");
    expect(result?.text).toBe("整理工具结果…");
  });

  it("maps final answer verification to a clear waiting state", () => {
    const ctx = createContext({
      requestActivityPhase: "verifying_final_answer",
    } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.phase).toBe("continuing");
    expect(result?.text).toBe("验证回答…");
  });

  it("maps permission_waiting phase correctly", () => {
    const ctx = createContext({
      requestActivityPhase: "permission_waiting",
    } as Partial<TuiContext>);
    const result = mapRequestActivityToView(ctx);
    expect(result).toBeDefined();
    expect(result?.phase).toBe("permission_waiting");
    expect(result?.text).toBe("等待权限确认");
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

  it("does not carry stale retryInfo after request activity is cleared", () => {
    const retrying = createContext({
      requestActivityPhase: "provider_retrying",
      retryInfo: { attempt: 1, max: 10, delaySec: 3 },
    } as Partial<TuiContext>);
    expect(mapRequestActivityToView(retrying)?.text).toContain("1/10");

    const cleared = createContext({ retryInfo: { attempt: 1, max: 10, delaySec: 3 } } as Partial<TuiContext>);
    expect(mapRequestActivityToView(cleared)).toBeUndefined();
    expect(createShellViewModel(cleared).activity?.text ?? "").not.toContain("1/10");
  });

  it("returns undefined for unknown phase values", () => {
    const ctx = createContext({
      requestActivityPhase: "unknown_phase" as unknown,
    } as Partial<TuiContext>);
    expect(mapRequestActivityToView(ctx)).toBeUndefined();
  });
});

describe("mapBottomPaneStatusToView — unified bottom status", () => {
  it("maps request running to running", () => {
    const ctx = createContext({ requestActivityPhase: "request_started" } as Partial<TuiContext>);
    const activity = mapRequestActivityToView(ctx);
    const status = mapBottomPaneStatusToView(ctx, { activity });

    expect(status).toMatchObject({ kind: "running", source: "request" });
    expect(status?.text).toBe("思考中…");
  });

  it("maps permission pending to a low-noise bottom status line", () => {
    const ctx = createContext({ requestActivityPhase: "request_started" } as Partial<TuiContext>);
    const permission = mapPendingApprovalToPermission({
      ...ctx,
      pendingLocalApproval: {
        kind: "model_tool_use",
        toolName: "Bash",
        toolCall: { input: { command: "git status" } },
      },
    } as unknown as TuiContext);
    const status = mapBottomPaneStatusToView(ctx, {
      activity: mapRequestActivityToView(ctx),
      permission,
    });

    expect(permission?.toolName).toBe("Bash");
    expect(status).toMatchObject({
      kind: "action_required",
      source: "permission",
      text: "等待确认 · Bash",
    });
  });

  it("maps final answer gate to verifying", () => {
    const ctx = createContext({
      requestActivityPhase: "verifying_final_answer",
    } as Partial<TuiContext>);
    const status = mapBottomPaneStatusToView(ctx, {
      activity: mapRequestActivityToView(ctx),
    });

    expect(status).toMatchObject({ kind: "verifying", source: "final_gate" });
    expect(status?.nextAction).toContain("scrollback");
  });

  it("maps compact cooldown/resource cap to blocked with next action", () => {
    const ctx = createContext();
    ctx.cache.compactFailure = {
      at: new Date().toISOString(),
      reason: "context_compact_cooldown_active",
      blocked: true,
      cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
    };
    ctx.cache.compactCooldownUntil = Date.now() + 60_000;

    const status = mapBottomPaneStatusToView(ctx);

    expect(status).toMatchObject({ kind: "blocked", source: "resource" });
    expect(status?.reason).toContain("context_compact");
    expect(status?.nextAction).toContain("冷却");
  });

  it("maps active blocked background task to blocked", () => {
    const ctx = createContext({
      backgroundTasks: [
        createBackgroundTask({
          status: "blocked",
          userVisibleSummary: "并发上限：等待后台槽位",
          nextAction: "用 /background 查看详情。",
        }),
      ],
    });

    const status = mapBottomPaneStatusToView(ctx);

    expect(status).toMatchObject({ kind: "blocked", source: "resource" });
    expect(status?.text).toBe("后台任务受阻");
    expect(status?.reason).toContain("并发上限");
  });

  it("ignores completed background task history even when it mentions resource cap", () => {
    const ctx = createContext({
      backgroundTasks: [
        createBackgroundTask({
          status: "completed",
          result: "partial",
          userVisibleSummary: "resource/concurrency cap 已解除",
          nextAction: "旧记录",
        }),
      ],
    });

    expect(mapBottomPaneStatusToView(ctx)).toBeUndefined();
  });

  it("ignores dismissed blocked background tasks", () => {
    const ctx = createContext({
      backgroundTasks: [
        createBackgroundTask({
          id: "bg-dismissed",
          status: "blocked",
          userVisibleSummary: "并发上限：等待后台槽位",
        }),
      ],
      dismissedBackgroundTaskIds: new Set(["bg-dismissed"]),
    } as Partial<TuiContext>);

    expect(mapBottomPaneStatusToView(ctx)).toBeUndefined();
  });

  it("maps provider failure to failed", () => {
    const ctx = createContext({
      language: "en-US",
      lastProviderFailure: {
        code: "HTTP_502",
        kind: "transit",
        provider: "openai",
        model: "gpt-5.5",
        endpointProfile: "default",
        summary: "HTTP 502",
      },
    } as unknown as Partial<TuiContext>);

    const status = mapBottomPaneStatusToView(ctx);

    expect(status).toMatchObject({ kind: "failed", source: "provider" });
    expect(status?.reason).toBe("HTTP 502");
  });

  it("does not let stale provider failure override active request status", () => {
    const ctx = createContext({
      requestActivityPhase: "request_started",
      lastProviderFailure: {
        code: "HTTP_502",
        kind: "transit",
        provider: "openai",
        model: "gpt-5.5",
        endpointProfile: "default",
        summary: "previous HTTP 502",
      },
    } as unknown as Partial<TuiContext>);

    const status = mapBottomPaneStatusToView(ctx, {
      activity: mapRequestActivityToView(ctx),
    });

    expect(status).toMatchObject({ kind: "running", source: "request" });
    expect(status?.reason).not.toBe("previous HTTP 502");
  });

  it("keeps request activity ahead of agent/workflow running summaries", () => {
    const ctx = createContext({
      requestActivityPhase: "tool_running",
      requestActivityToolName: "Bash",
    } as unknown as Partial<TuiContext>);
    const status = mapBottomPaneStatusToView(ctx, {
      activity: mapRequestActivityToView(ctx),
      visibleWorkState: {
        mainRequestActive: true,
        userInputPending: false,
        toolsRunning: true,
        agentsRunning: 1,
        backgroundTasksRunning: 0,
        explicitWorkflowRunning: false,
        multiAgentWorkflowRunning: false,
        pendingCompletionCount: 0,
        scrollDetached: false,
        unseenCount: 0,
      },
    });

    expect(status).toMatchObject({ kind: "running", source: "tool" });
    expect(status?.text).toContain("Bash");
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
    // D.13L Block 0-B — 主屏只保留 actionSummary，scope/reason/hint 内部留空。
    expect(result?.actionSummary).toContain("rm -rf /tmp/test");
    expect(result?.actionSummary).toContain("运行终端命令");
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
    expect(result?.actionSummary).toContain("src/main.ts");
    expect(result?.actionSummary).toContain("修改文件");
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
    // architecture_drift 是范围变化确认，不应伪装成普通工具授权。
    expect(result?.actionSummary).toContain("确认范围变化");
    expect(result?.actionSummary).toContain("core/api.ts");
    expect(result?.actionSummary).toContain("修改文件");
    expect(result?.actionSummary).not.toBe("修改文件：core/api.ts");
  });

  it("D.14D-R P0-1: maps index_ignore_write approval to a Write PermissionPanel view", () => {
    // /index repair 的 ignore 写入是一次 Write 提权；ink 主屏必须走 PermissionPanel。
    const ctx = createContext({
      pendingLocalApproval: {
        kind: "index_ignore_write",
        plan: { path: ".cbmignore" },
      },
    } as unknown as Partial<TuiContext>);
    const result = mapPendingApprovalToPermission(ctx);
    expect(result).toBeDefined();
    expect(result?.toolName).toBe("Write");
    expect(result?.risk).toBe("medium");
    expect(result?.scope).toContain(".cbmignore");
    expect(result?.actionSummary).toContain(".cbmignore");
    expect(result?.actionSummary).toContain("修改文件");
    expect(result?.actions?.map((item) => item.id)).toEqual(["allow_once", "deny", "details"]);
    expect(result?.actions?.map((item) => item.id)).not.toContain("allow_always_tool");
  });

  it("D.14D-R2 P1-1: maps git_stable_point approval to a GitStablePointCreate PermissionPanel view", () => {
    const ctx = createContext({
      pendingLocalApproval: {
        kind: "git_stable_point",
        sessionId: "session-1",
        toolCall: { id: "call-1", name: "GitStablePointCreate", input: {} },
      },
    } as unknown as Partial<TuiContext>);
    const result = mapPendingApprovalToPermission(ctx);
    expect(result).toBeDefined();
    expect(result?.toolName).toBe("GitStablePointCreate");
    expect(result?.risk).toBe("medium");
    expect(result?.actionSummary).toContain("稳定点");
  });

  it("maps image_generation approval to a Write PermissionPanel view", () => {
    const ctx = createContext({
      pendingLocalApproval: {
        kind: "image_generation",
        sessionId: "session-1",
        prompt: "logo concept",
        id: "image-123",
        assetPath: ".linghun/assets/image-123.json",
        provider: "deepseek",
        model: "deepseek-image",
      },
    } as unknown as Partial<TuiContext>);
    const result = mapPendingApprovalToPermission(ctx);
    expect(result).toBeDefined();
    expect(result?.toolName).toBe("Write");
    expect(result?.risk).toBe("medium");
    expect(result?.scope).toContain(".linghun/assets/image-123.json");
    expect(result?.actionSummary).toContain("image metadata");
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
    expect(result?.actionSummary).toContain("Run terminal command");
    expect(result?.actionSummary).toContain("npm install");
  });
});

describe("backgroundSummaries → blocks mapping", () => {
  it("keeps running background tasks out of the default task runtime summary", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        {
          id: "t1",
          title: "lint check",
          status: "running",
          currentStep: "checking files",
          progress: { completed: 1, total: 3, label: "steps" },
          nextAction: "等待完成，或用 /interrupt 中断。",
        },
        { id: "t2", title: "test suite", status: "completed", result: "pass" },
      ],
    });
    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
    expect(view.taskRuntimeSummary).toBeUndefined();
  });

  it("keeps terminal background statuses out of the default task runtime summary", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        {
          id: "t3",
          title: "deploy",
          status: "failed",
          result: "fail",
          currentStep: "sourceRef schema debug runner=abc endpoint raw evidence",
        },
        { id: "t4", title: "health check", status: "timeout" },
      ],
    });
    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
    expect(view.taskRuntimeSummary).toBeUndefined();
  });

  it("keeps raw/internal background fields out of the default task surface", () => {
    const view = createShellViewModel(createContext(), {
      width: 100,
      viewMode: "task",
      backgroundSummaries: [
        {
          id: "job-raw-summary",
          kind: "job",
          title: "Job deploy gateId gate-123 requestId req-123 C:\\Users\\Admin\\secret\\job.log",
          status: "blocked",
          currentStep:
            "fullOutputPath C:\\Users\\Admin\\secret\\full-output.log logPath /tmp/private/job.log raw evidence tool_result raw endpoint runner=debug schemaLoaded",
          nextAction: "inspect /job report job-raw-summary and /job logs job-raw-summary",
        },
      ],
    });

    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
    expect(view.taskRuntimeSummary).toBeUndefined();
  });

  it("folds stale agent background status without exposing worker internals", () => {
    const view = createShellViewModel(createContext(), {
      width: 100,
      viewMode: "task",
      backgroundSummaries: [
        {
          id: "agent-stale-1",
          kind: "agent",
          title: "Agent cli-tui-worker",
          status: "stale",
          currentStep: "stale/resumable",
        },
      ],
    });
    expect(view.taskRuntimeSummary).toBeUndefined();
  });

  it("keeps en-US running background summaries out of the default main surface", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "t5", title: "build", status: "running" }],
    });
    expect(view.blocks.find((b) => b.id === "bg-summary")).toBeUndefined();
    expect(view.taskRuntimeSummary).toBeUndefined();
  });

  it("completed-only background tasks stay low-noise and do not become PASS", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "t6", title: "job", status: "completed" }],
    });
    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
    expect(view.taskRuntimeSummary).toBeUndefined();
  });

  it("renders task runtime summary on Ink and plain task main surfaces", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const context = createContext({
      backgroundTasks: [
        {
          id: "verify-stale",
          kind: "verification",
          title: "Verification Runner",
          status: "stale",
          startedAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:01.000Z",
          heartbeatIntervalMs: 30_000,
          staleAfterMs: 120_000,
          logPath: "F:\\Linghun\\.linghun\\logs\\verification",
          hasOutput: true,
          userVisibleSummary: "verification stale",
        },
        {
          id: "job-cancelled",
          kind: "job",
          title: "Job cancelled",
          status: "cancelled",
          startedAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:02.000Z",
          heartbeatIntervalMs: 30_000,
          staleAfterMs: 120_000,
          logPath: "F:\\Linghun\\.linghun\\logs\\jobs",
          hasOutput: true,
          userVisibleSummary: "job cancelled",
        },
      ],
    });
    const controller = {
      getViewModel: () =>
        createShellViewModel(context, {
          width: output.columns,
          height: output.rows,
          viewMode: "task",
          backgroundSummaries: [],
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

    expect(output.text).not.toContain("后台 2");
    expect(output.text).not.toContain("可能卡住 1");
    expect(output.text).not.toContain("已取消 1");
    expect(output.text).not.toContain("Verification Runner");
    expect(output.text).not.toContain("Job cancelled");

    const plain = renderPlainShell(controller.getViewModel());
    expect(plain).not.toContain("后台 2");
    expect(plain).not.toContain("可能卡住 1");
    expect(plain).not.toContain("已取消 1");
    expect(plain).not.toContain("Verification Runner");
    expect(plain).not.toContain("Job cancelled");
  });

  it("startup hydrate-style terminal and stale agent history stay out of the default task surface", () => {
    const terminalOnly = createShellViewModel(createContext(), {
      width: 100,
      viewMode: "task",
      backgroundSummaries: [
        { id: "agent-blocked-old", kind: "agent", title: "Agent cli-tui-worker", status: "failed" },
        { id: "job-completed-old", kind: "job", title: "Job old", status: "completed" },
        { id: "agent-cancelled-old", kind: "agent", title: "Agent cancelled", status: "cancelled" },
      ],
    });
    expect(terminalOnly.taskRuntimeSummary).toBeUndefined();

    const recoverable = createShellViewModel(createContext(), {
      width: 100,
      viewMode: "task",
      backgroundSummaries: [
        { id: "agent-blocked-old", kind: "agent", title: "Agent cli-tui-worker", status: "failed" },
        { id: "agent-running", kind: "agent", title: "Agent active", status: "running" },
        {
          id: "agent-stale",
          kind: "agent",
          title: "Agent resumed",
          status: "stale",
          currentStep: "stale/resumable",
        },
      ],
    });
    expect(recoverable.taskRuntimeSummary).toBeUndefined();
  });

  it("task mode does not show background blocks by default", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      backgroundSummaries: [{ id: "t7", title: "lint", status: "running" }],
    });
    expect(view.viewMode).toBe("task");
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
        actions: [],
      },
    });
    expect(view.composer.placeholder).toContain("y 同意");
    expect(view.composer.placeholder).toContain("n 拒绝");
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
        actions: [],
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

describe("D.12B — P1-1: output blocks keep last 20", () => {
  it("keeps up to 20 output blocks in task mode", () => {
    // Use messageKind="assistant_text" blocks that won't be grouped.
    const blocks: ProductBlockViewModel[] = Array.from({ length: 22 }, (_, i) => ({
      id: `out-${i}`,
      kind: "details" as const,
      status: "info" as const,
      title: "",
      summary: `unique block ${i}`,
      fullText: `unique block ${i}`,
      messageKind: "assistant_text" as const,
    }));
    // height=200 ensures viewport virtualization doesn't clip blocks.
    const view = createShellViewModel(createContext(), {
      width: 80,
      height: 200,
      outputBlocks: blocks,
    });
    const outputIds = view.blocks.map((b) => b.id).filter((id) => id.startsWith("out-"));
    // maxEphemeral=20: oldest 2 pruned, 20 remain.
    expect(outputIds.length).toBe(20);
    expect(outputIds).not.toContain("out-0");
    expect(outputIds).not.toContain("out-1");
    expect(outputIds).toContain("out-2");
    expect(outputIds).toContain("out-21");
  });

  it("prunes oldest ephemeral blocks beyond cap", () => {
    // Same verification from a different angle.
    const blocks: ProductBlockViewModel[] = Array.from({ length: 25 }, (_, i) => ({
      id: `out-${i}`,
      kind: "details" as const,
      status: "info" as const,
      title: "",
      summary: `unique block ${i}`,
      fullText: `unique block ${i}`,
      messageKind: "assistant_text" as const,
    }));
    const view = createShellViewModel(createContext(), {
      width: 80,
      height: 200,
      outputBlocks: blocks,
    });
    const outputIds = view.blocks.map((b) => b.id).filter((id) => id.startsWith("out-"));
    // Oldest 5 ephemeral pruned (25 - 20 = 5).
    expect(outputIds).not.toContain("out-0");
    expect(outputIds).not.toContain("out-4");
    expect(outputIds).toContain("out-5");
    expect(outputIds).toContain("out-24");
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

describe("D.12B — P1-2: narrow terminal status keeps background", () => {
  it("width=40 shows background count with short label", () => {
    const view = createShellViewModel(createContext(), { width: 40 });
    expect(view.status.background).toBe("后台:1");
  });

  it("width=80 shows full background label", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    expect(view.status.background).toBe("后台：1");
  });

  it("en-US width=40 shows BG:N short label", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), { width: 40 });
    expect(view.status.background).toBe("BG:1");
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

  it("running/blocked jobs stay out of the default task summary", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        { id: "j2", title: "test", status: "running" },
        { id: "j3", title: "deploy", status: "failed" },
        { id: "j4", title: "health", status: "stale" },
        { id: "j5", title: "blocked job", status: "blocked" },
      ],
    });
    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
    expect(view.taskRuntimeSummary).toBeUndefined();
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
    expect(rendered).not.toContain("项目：");
  });

  it("legacy home override is normalized to task", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      submitted: true,
      viewMode: "home",
    });
    expect(view.viewMode).toBe("task");
  });
});

describe("D.12B — P3-1: home vision copy", () => {
  it("omits vision text in zh-CN and en-US", () => {
    expect(createShellViewModel(createContext(), { width: 40 }).homeVision).toBe("");
    expect(createShellViewModel(createContext(), { width: 80 }).homeVision).toBe("");
    expect(
      createShellViewModel(createContext({ language: "en-US" }), { width: 40 }).homeVision,
    ).toBe("");
  });
});

describe("D.12B — P3-2: plain task header total length control", () => {
  it("status tray does not exceed view width", () => {
    const ctx = createContext({
      projectPath: "/tmp/a-very-long-project-name-that-exceeds-normal-width",
      model: "deepseek-v4-flash-with-extremely-long-model-name-variant",
    });
    const view = createShellViewModel(ctx as unknown as TuiContext, { width: 60 });
    expect(view.status.project.length).toBeLessThanOrEqual(32);
    expect(view.status.model.length).toBeLessThanOrEqual(32);
  });
});

describe("D.12B — P2-5: no-color does not force white", () => {
  it("no-color plain render keeps stale background out of the task summary", () => {
    const view = createShellViewModel(createContext(), {
      noColor: true,
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "nc1", title: "task", status: "stale" }],
    });
    const rendered = renderPlainShell(view);
    expect(rendered).not.toContain("后台：1");
    expect(rendered).not.toContain("可能卡住 1");
    expect(rendered).not.toContain("/background");
    expect(rendered).not.toContain("task");
    expect(rendered).not.toContain("需要确认 1");
    expect(rendered).not.toContain("可恢复");
    expect(rendered).not.toContain("上次会话恢复的后台任务");
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
    expect(lines).toEqual(["我能帮您做点什么？"]);
    // No fake cursor characters
    expect(lines.join("")).not.toContain("\u258C");
    expect(lines.join("")).not.toContain("|");
    // cursorCol is relative to the editor surface, not the visual prompt marker.
    expect(cursorRow).toBe(0);
    expect(cursorCol).toBe(0);

    // Plain renderer shows placeholder inside composer box as hint (no "> " prefix)
    const rendered = renderPlainShell(createShellViewModel(createContext(), { width: 80 }));
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("我能帮您做点什么？");
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
    expect(lines).toEqual(["修复光标"]);
    // cursor at end of "修复光标" (4*2 = 8)
    expect(cursorRow).toBe(0);
    expect(cursorCol).toBe(8);
  });

  it("soft-wraps long single-line Composer input instead of horizontal ellipsis", () => {
    const { lines, cursorRow } = formatComposerRenderLines({
      buffer: createEditBuffer("abcdefghijklmnopqrstuvwxyz"),
      placeholder: "我能帮您做点什么？",
      masking: false,
      noColor: false,
      maxWidth: 12,
    });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).not.toContain("…");
    expect(cursorRow).toBe(lines.length - 1);
  });

  it("multiline Composer render reports cursor on the last line", () => {
    const { lines, cursorCol, cursorRow } = formatComposerRenderLines({
      buffer: createEditBuffer("第一行\n第二行\n第三行"),
      placeholder: "我能帮您做点什么？",
      masking: false,
      noColor: false,
    });
    expect(lines).toEqual(["第一行", "第二行", "第三行"]);
    expect(lines.join("\n")).not.toContain("\u258C");
    expect(cursorRow).toBe(2);
    // "第三行" = 3*2 = 6
    expect(cursorCol).toBe(6);
  });

  it("Composer cursor row stays relative to the text anchor", () => {
    expect(
      composerCursorAnchorRowOffset({
        textAnchorRowBase: 0,
        permissionActive: false,
        permissionActionCount: 0,
        showSuggestions: false,
        slashCandidateCount: 0,
        cursorRow: 0,
      }),
    ).toBe(0);
  });

  it("Composer cursor row follows soft-wrapped home input relative to the text anchor", () => {
    const { cursorRow } = formatComposerRenderLines({
      buffer: createEditBuffer(
        "修复这个项目的 bug。最后告诉我你改了什么、跑了什么验证。如果没有真实跑通测试，不要说测试通过。",
      ),
      placeholder: "我能帮您做点什么？",
      masking: false,
      noColor: false,
      maxWidth: 76,
    });
    expect(cursorRow).toBe(1);
    expect(
      composerCursorAnchorRowOffset({
        textAnchorRowBase: 0,
        permissionActive: false,
        permissionActionCount: 0,
        showSuggestions: false,
        slashCandidateCount: 0,
        cursorRow,
      }),
    ).toBe(1);
  });

  it("Composer cursor row keeps task text anchor relative to the same text column", () => {
    expect(
      composerCursorAnchorRowOffset({
        textAnchorRowBase: 0,
        permissionActive: false,
        permissionActionCount: 0,
        showSuggestions: false,
        slashCandidateCount: 0,
        cursorRow: 0,
      }),
    ).toBe(0);
  });

  it("Composer cursor row does not double-count visible slash suggestion layout", () => {
    expect(
      composerCursorAnchorRowOffset({
        textAnchorRowBase: 0,
        permissionActive: false,
        permissionActionCount: 0,
        showSuggestions: true,
        slashCandidateCount: 3,
        cursorRow: 1,
      }),
    ).toBe(1);
  });

  it("no-color Composer render has no fake cursor characters", () => {
    const { lines, cursorCol } = formatComposerRenderLines({
      buffer: createEditBuffer("修复光标"),
      placeholder: "我能帮您做点什么？",
      masking: false,
      noColor: true,
    });
    expect(lines).toEqual(["修复光标"]);
    expect(lines.join("\n")).not.toContain("\u258C");
    expect(lines.join("\n")).not.toContain("|");
    expect(cursorCol).toBe(8);

    const rendered = renderPlainShell(
      createShellViewModel(createContext(), { noColor: true, width: 80 }),
    );
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("\u258C");
  });

  it("plain task render keeps compact brand before task content", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    const lines = rendered.split("\n");
    const brandIdx = lines.findIndex((l) => l.trim() === "LingHun");
    expect(brandIdx).toBeGreaterThanOrEqual(0);
    const separatorLine = lines[brandIdx + 1];
    expect(separatorLine).toBeDefined();
    expect((separatorLine as string).trim()).toMatch(/^-+$/);
    expect(rendered).not.toContain("技术普惠");
    expect(lines.findIndex((l) => l.includes("我能帮您做点什么？"))).toBe(-1);
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

  it("ink-renderer resize clears the bottom frame without replaying native scrollback", async () => {
    const source = await readFile(join(SRC_ROOT, "shell/ink-renderer.tsx"), "utf8");
    const resizeStart = source.indexOf("const onResize = () =>");
    expect(resizeStart).toBeGreaterThan(0);
    const resizeEnd = source.indexOf("};", resizeStart + 30);
    const body = source.slice(resizeStart, resizeEnd);
    expect(body).toContain("if (!useAlternateScreen)");
    // Native scrollback stays append-only: resize must not replay flushed
    // history or clear terminal scrollback, only the live bottom frame.
    expect(body).not.toContain("shouldReplayNativeScrollbackOnResize");
    expect(body).not.toContain("beforeNativeScrollbackResizeReflow");
    expect(body).toContain("clearNativeScrollbackFrameUnion(");
    expect(body).not.toContain("previousFrameAnchorRow");
    expect(body).not.toContain('writeBestEffort(stdout, "\\x1B[2J\\x1B[3J\\x1B[H")');
    expect(body).toContain("controller.onResize?.()");
  });

  it("task ink render stays on task layout without home vision", async () => {
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

    expect(output.text).not.toContain("LingHun");
    expect(output.text).not.toContain("技术普惠会越来越成熟");
    expect(output.text).toContain("继续输入…");
  });

  it("width=40 does not crash", () => {
    const view = createShellViewModel(createContext(), { noColor: true, width: 40 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("我能帮您做点什么？");
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

  it("Task does not show background blocks", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
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

  it("Task keeps running/blocked background out of the default main surface", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        { id: "bg1", title: "lint", status: "running" },
        { id: "bg2", title: "deploy", status: "failed" },
        { id: "bg3", title: "health", status: "timeout" },
        { id: "bg4", title: "old", status: "stale" },
        { id: "bg5", title: "blocked", status: "blocked" },
      ],
    });
    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
    expect(view.taskRuntimeSummary).toBeUndefined();
  });

  it("fail/blocking output prioritized over normal output", () => {
    // D.13Q-UX Real Smoke Fix v3：fail 块按 append 顺序保留，不再被推到顶；
    // 限流只对 ephemeral 生效（cap=20），fail/keep 不计入 cap。
    const failBlock: ProductBlockViewModel = {
      id: "out-fail",
      kind: "error",
      status: "fail",
      title: "Error",
      summary: "Something failed",
      fullText: "Something failed",
      messageKind: "tool_result_error",
    };
    const normalBlocks: ProductBlockViewModel[] = Array.from({ length: 22 }, (_, i) => ({
      id: `out-${i}`,
      kind: "details" as const,
      status: "info" as const,
      title: `Unique-Normal-${i}`,
      summary: `ok ${i}`,
      fullText: `ok ${i}`,
      messageKind: "assistant_text" as const,
    }));
    const view = createShellViewModel(createContext(), {
      width: 80,
      height: 200,
      viewMode: "task",
      outputBlocks: [failBlock, ...normalBlocks],
    });
    const outputBlocks = view.blocks.filter((b) => b.id.startsWith("out-"));
    expect(outputBlocks.find((b) => b.id === "out-fail")).toBeDefined();
    // ephemeral cap=20，fail 不计入：22 ephemeral - cap 20 = 2 pruned。
    const ephemeralCount = outputBlocks.filter(
      (b) => b.status !== "fail" && b.status !== "blocked" && !b.keep,
    ).length;
    expect(ephemeralCount).toBeLessThanOrEqual(20);
    // out-0/out-1 应该被丢（最早 ephemeral 超出 cap），out-21 保留。
    expect(outputBlocks.find((b) => b.id === "out-0")).toBeUndefined();
    expect(outputBlocks.find((b) => b.id === "out-1")).toBeUndefined();
    expect(outputBlocks.find((b) => b.id === "out-21")).toBeDefined();
  });

  it("normal output max 20 items", () => {
    const blocks: ProductBlockViewModel[] = Array.from({ length: 25 }, (_, i) => ({
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
    expect(outputBlocks.length).toBeLessThanOrEqual(20);
  });

  it("ordinary multi-line assistant output stays fully visible without Ctrl+O", () => {
    const block = createOutputBlock(
      "some output text\nwith additional lines that exceed summary",
      "zh-CN",
      "out-hint",
    );
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const outBlock = view.blocks.find((b) => b.id === "out-hint");
    expect(outBlock?.nextAction).toBeUndefined();
    expect(outBlock?.summary).toContain("with additional lines");
  });

  it("D13E-P3 #2: short single-line normal output has NO Ctrl+O hint (no fake fold)", () => {
    // Final-answer / completion / "我能帮您做点什么？" 短回声 → 不展示 Ctrl+O 行。
    const shortAnswer = createOutputBlock("已完成。", "zh-CN", "out-short");
    expect(shortAnswer.nextAction).toBeUndefined();

    const placeholderEcho = createOutputBlock("我能帮您做点什么？", "zh-CN", "out-echo");
    expect(placeholderEcho.nextAction).toBeUndefined();

    const enShort = createOutputBlock("Done.", "en-US", "out-done");
    expect(enShort.nextAction).toBeUndefined();
  });

  it("D13E-P3 #2: ordinary multi-line assistant / diagnostic body does not auto-fold", () => {
    const multiLine = createOutputBlock(
      "checking provider...\nendpoint: https://example.com\nreasoning: high\nstatus: ok",
      "zh-CN",
      "out-multi",
    );
    expect(multiLine.nextAction).toBeUndefined();
    expect(multiLine.summary).toContain("status: ok");

    // D.13Q-UX Real Smoke Fix v3：含 "error / failed / 失败" 关键词的多行正文
    // 不再被关键词扫描误标 fail，也不会因为普通多行自动折叠。
    const errorStack = createOutputBlock(
      "Error: request failed\n  at provider.send\n  at gateway.invoke",
      "zh-CN",
      "out-stack",
    );
    expect(errorStack.status).toBe("info");
    expect(errorStack.kind).toBe("details");
    expect(errorStack.messageKind).toBe("assistant_text");
    expect(errorStack.nextAction).toBeUndefined();
    expect(errorStack.summary).toContain("gateway.invoke");
  });

  it("D13E-P3 #2: long single-line output is treated as folded only past the 16-char threshold", () => {
    // Short single-line: no hint. The cap is summary.length + 16, so a 5-char
    // body (no newline) must NOT trigger.
    const tiny = createOutputBlock("hello", "en-US", "out-tiny");
    expect(tiny.nextAction).toBeUndefined();

    // A genuinely-long single-line body: hint visible.
    const long = createOutputBlock("x".repeat(200), "en-US", "out-long");
    // Single-line normalize means summary == body, so summary+16 cap won't
    // actually trigger — but createOutputBlock's hasMore looks at total len vs
    // summary len; since they're equal, this should NOT carry the hint either,
    // because there's nothing folded to reveal.
    expect(long.nextAction).toBeUndefined();
  });

  it("D13E-P3 #2: addDetailsHint via outputBlocks pipeline respects the same discipline", () => {
    const shortBlock: ProductBlockViewModel = {
      id: "short",
      kind: "details",
      status: "info",
      title: "",
      summary: "已完成。",
      fullText: "已完成。",
    };
    const longBlock: ProductBlockViewModel = {
      id: "long",
      kind: "details",
      status: "info",
      title: "",
      summary: "checking provider...",
      fullText: "checking provider...\nendpoint: https://example.com\nreasoning: high\nstatus: ok",
    };
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [shortBlock, longBlock],
    });
    const out1 = view.blocks.find((b) => b.id === "short");
    const out2 = view.blocks.find((b) => b.id === "long");
    expect(out1?.nextAction).toBeUndefined();
    expect(out2?.nextAction).toBeUndefined();
    expect(out2?.fullText).toContain("status: ok");
  });

  it("D13E-P3 #3: ProductBlock filters out title='unknown' / empty as no-title (source check)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ProductBlock.tsx"), "utf8");
    // The render path must drop "unknown" titles via a dedicated guard, not just
    // a truthy check on block.title — that's the reason "● unknown" was leaking.
    expect(source).toContain("isMeaningfulTitle");
    expect(source).toMatch(/trimmed\.toLowerCase\(\)\s*===\s*"unknown"/);
  });

  it("D13E-P3 #3: ProductBlock promotes summary to marker line when title is dropped", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ProductBlock.tsx"), "utf8");
    // Two render branches: titleVisible → title row; summaryAsMarker → summary
    // gets the "● {summary}" treatment so "我不能讨论这个。" still has presence.
    expect(source).toContain("summaryAsMarker");
    expect(source).toContain('fitText(block.summary, Math.max(8, innerWidth - 2))');
  });

  it("D13E-P3 #3: ProductBlock returns null when title=unknown AND no visible body", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ProductBlock.tsx"), "utf8");
    // Empty title + empty summary + no detail/nextAction → render nothing.
    // Avoid the orphan "● " line that the old fallback path could produce.
    expect(source).toMatch(
      /!titleVisible\s*&&\s*!summaryTrimmed\s*&&\s*!block\.detail\s*&&\s*!block\.nextAction/,
    );
  });

  it("D13E-P3 #4: ShellBlockOutput silently drops '[Linghun] 会话 …' StatusTray dump", () => {
    const blocks: ProductBlockViewModel[] = [];
    let onWriteCount = 0;
    const ctx = createContext();
    const sink = __testCreateShellBlockOutput(ctx, blocks, () => {
      onWriteCount += 1;
    });
    sink.write(
      "[Linghun] 会话 abc123 · 模型 gpt · 模式 默认模式 · 缓存? · 索引? · 确认 无 · 后台 0\n",
    );
    expect(blocks.length).toBe(0);
    expect(onWriteCount).toBe(0);
    // 普通输出依然落 block，证明只是丢 dump，不是整体阻断。
    sink.write("正常输出\n");
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.summary).toBe("正常输出");
  });

  it("D13E-P3 #4: ShellBlockOutput silently drops 'Status: Session …' English variant", () => {
    const blocks: ProductBlockViewModel[] = [];
    const ctx = createContext({ language: "en-US" });
    const sink = __testCreateShellBlockOutput(ctx, blocks, () => undefined);
    sink.write(
      "Status: Session abc123 · Model gpt · Mode default mode · Cache? · Index? · Gate none · BG 0\n",
    );
    expect(blocks.length).toBe(0);
    sink.write(
      "  · Gate none · BG 0  ", // bare fragment without prefix — must still drop via Gate/BG token combo
    );
    expect(blocks.length).toBe(0);
  });

  it("D13E-P3 #4: error stacks containing 'Gate' word do NOT match the dump filter", () => {
    const blocks: ProductBlockViewModel[] = [];
    const ctx = createContext();
    const sink = __testCreateShellBlockOutput(ctx, blocks, () => undefined);
    // 真实错误堆栈或文档输出可能提到 "Gate" 但缺少 "· BG" 这种 StatusTray token。
    sink.write("error: Gate authorization failed at handler\n");
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.summary).toContain("error: Gate authorization failed");
  });

  it("D13E-P3 #5: /model doctor surfaces reasoning effective/ignored disambiguation per provider", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "model-doctor-runtime.ts"), "utf8");
    // doctor body must distinguish three states so users can tell whether
    // LINGHUN_INFERENCE_LEVEL=High actually flows to the request:
    //   - configured + responses/permissive  → effective/sent level X
    //   - configured + strict_openai_compatible → ignored/unsupported/未生效
    //   - not configured → not configured/未生效
    expect(source).toContain("effective/sent level ");
    expect(source).toContain("ignored/unsupported/未生效");
    expect(source).toContain("not configured/未生效");
  });

  it("D13E-P3 #5: /model echo prints 'reasoning=<status>' so users see runtime decision", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "model-command-runtime.ts"), "utf8");
    // /model body must include reasoning status so the user has a fast surface
    // outside the (size-limited) footer.
    expect(source).toMatch(/reasoning \${runtime\.reasoningStatus}/);
  });

  it("D13E-P3 #6: useAnchoredCursor no longer gates render on hasMeasured (first-frame focus)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/useAnchoredCursor.ts"), "utf8");
    // The first-frame cursor was hidden because hasMeasured flips inside a
    // useEffect (one frame after yoga commits). The desired-position guard
    // now relies on getAbsoluteOrigin's intrinsic null-check, so the cursor
    // appears immediately on the first frame whenever yoga layout is ready.
    expect(source).not.toMatch(/declared\s*&&\s*capability\.cursorPositioning\s*&&\s*hasMeasured/);
    // Still subscribes to useBoxMetrics for the resize re-run.
    expect(source).toContain("useBoxMetrics(anchorRef)");
    expect(source).toContain("!declared || !capability.cursorPositioning");
    expect(source).toContain("useLayoutEffect(");
    expect(source).toContain("resolveAnchoredCursorPosition");
  });

  it("D13E-P3 #6: Composer renders one inline cursor and hides the native cursor", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    expect(source).toContain("useAnchoredCursor(null, anchorRef, capability)");
    expect(source).toContain("renderInlineComposerCursor");
    expect(source).toContain("INLINE_CURSOR_BLINK_MS");
    expect(source).toContain("<Text inverse>{cursorCell}</Text>");
    expect(source).toContain("ref={anchorRef}");
  });

  it("error output has Ctrl+O hint for full error", () => {
    // D.13Q-UX Real Smoke Fix v3：单行短正文（哪怕含 "error / failed"）不再被
    // 关键词扫描标 fail，也不挂 Ctrl+O；只有真正可折叠（多行/单行明显超长）
    // 的正文才挂 Ctrl+O。
    const single = createOutputBlock("error: something failed badly", "zh-CN", "out-err");
    expect(single.status).toBe("info");
    expect(single.kind).toBe("details");
    expect(single.nextAction).toBeUndefined();
    const multi = createOutputBlock(
      "error: build failed\n  at compile.ts:42\n  at runner.ts:17",
      "zh-CN",
      "out-err-multi",
    );
    expect(multi.status).toBe("info");
    expect(multi.nextAction).toBeUndefined();
    expect(multi.summary).toContain("runner.ts:17");
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
    // "你好世界" (4*2=8)
    expect(cursorCol).toBe(8);
  });

  it("masking cursor position uses masked length", () => {
    const { cursorCol, lines } = formatComposerRenderLines({
      buffer: createEditBuffer("secret"),
      placeholder: "placeholder",
      masking: true,
      noColor: false,
    });
    expect(cursorCol).toBe(6);
    expect(lines[0]).toContain("******");
  });

  it("truncated multiline shows line count and correct cursor row", () => {
    const text = Array.from({ length: 8 }, (_, i) => `line${i}`).join("\n");
    const { lines, truncatedAbove, truncatedBelow, cursorRow } = formatComposerRenderLines({
      buffer: createEditBuffer(text),
      placeholder: "placeholder",
      masking: false,
      noColor: false,
    });
    // Buffer cursor is at end of last line; window is cursor-centered with size 5.
    // 8 lines, cursor at line 7 → window covers lines 3..7 → 3 lines above truncated.
    expect(truncatedAbove + truncatedBelow).toBe(3);
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

  it("plain renderer Task folds fail details behind Ctrl+O", () => {
    // D.13Q-UX Real Smoke Fix v3：fail 块由调用方显式构造，不再依赖关键词扫描。
    // 多行 fail 正文才挂 Ctrl+O 错误展开 hint。
    const block: ProductBlockViewModel = {
      id: "out-plain-err",
      kind: "error",
      status: "fail",
      title: "Bash failed",
      summary: "exit 1",
      fullText: "exit 1\nstderr line A\nstderr line B",
      messageKind: "tool_result_error",
    };
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("Ctrl+O");
    expect(rendered).toContain("exit 1");
    expect(rendered).not.toContain("stderr line A");
    // fail status marker (✗ in color mode, [FAIL] in no-color)
    expect(rendered).toContain("\u2717");
  });

  it("80x24 and 40 width do not render a fake placeholder prompt", () => {
    for (const width of [80, 40]) {
      const view = createShellViewModel(createContext(), { width, height: 24 });
      const rendered = renderPlainShell(view);
      expect(rendered).toContain("LingHun");
      expect(rendered).not.toContain("我能帮您做点什么？");
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
    // Task-only plain fallback no longer renders the old Home placeholder.
    expect(rendered).not.toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
  });

  it("TTY legacy fallback outputs renderPlainShell task product layout", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    // Product shell structure: compact task brand + separator only.
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
    expect(rendered).not.toContain("技术普惠会越来越成熟");
    expect(rendered).not.toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    expect(rendered).not.toContain("项目：");
    expect(rendered).not.toContain("模型：");
    expect(rendered).not.toContain("权限：");
  });

  it("non-TTY pipe mode can still use plain text without product frame", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    // Even legacy gets structured output, not raw REPL
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
  });

  it("cmd fallback includes ASCII-safe compact header, no ASCII art", () => {
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
    expect(rendered).not.toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    expect(rendered).not.toContain("项目：");
    expect(rendered).not.toContain("模型：");
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

  it("modern terminal plain task render uses Unicode separator", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), { width: 80, viewMode: "task" });
    const rendered = renderPlainShell(view);
    // Task view has ─ separator lines (no ═ hero frame)
    expect(rendered).toContain("─");
    expect(rendered).not.toContain("═");
    // Compact header without version
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("v0.1.0");
  });

  it("plain task contains LingHun, separator, and no home vision/status tray", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const view = createShellViewModel(createContext(), { width: 80, height: 24 });
    const rendered = renderPlainShell(view);
    const lines = rendered.split("\n");

    // Brand
    expect(rendered).toContain("LingHun");
    // Task separator (─ repeated across the task composer width)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching ESC control character
    const ANSI_STRIP = /\x1B\[[0-9;]*m/g;
    const underlineIdx = lines.findIndex((l) =>
      /^[\s]*─{40,}[\s]*$/.test(l.replace(ANSI_STRIP, "")),
    );
    expect(underlineIdx).toBeGreaterThan(0);
    // Vision
    expect(rendered).not.toContain("技术普惠会越来越成熟");
    const composerLineCount = lines.filter((l) => {
      const stripped = l.replace(ANSI_STRIP, "");
      return /^─{40,}$/.test(stripped.trim());
    }).length;
    expect(composerLineCount).toBe(1);
    expect(rendered).not.toContain("项目：");
    expect(rendered).not.toContain("模型：");
    // No version number
    expect(rendered).not.toContain("v0.1.0");
    // No large ASCII art
    expect(rendered).not.toContain("|____|");
    expect(rendered).not.toContain("_     _");
  });

  it("plain task does not render localized composer placeholder", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const zhView = createShellViewModel(createContext({ language: "zh-CN" }), { width: 80 });
    const enView = createShellViewModel(createContext({ language: "en-US" }), { width: 80 });
    const zhRendered = renderPlainShell(zhView);
    const enRendered = renderPlainShell(enView);

    expect(zhRendered).not.toContain("我能帮您做点什么？");
    expect(zhRendered).not.toContain("> 我能帮您做点什么？");
    expect(enRendered).not.toContain("What can I help you with?");
    expect(enRendered).not.toContain("> What can I help you with?");
  });

  it("color plain task contains ANSI escapes; no-color plain task does not", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const colorView = createShellViewModel(createContext(), { width: 80 });
    const noColorView = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const colorRendered = renderPlainShell(colorView);
    const noColorRendered = renderPlainShell(noColorView);

    expect(colorRendered).toContain("\x1B[");
    expect(noColorRendered).not.toContain("\x1B[");
    expect(colorRendered).not.toContain("我能帮您做点什么？");
    expect(colorRendered).not.toContain("> 我能帮您做点什么？");
    expect(noColorRendered).not.toContain("我能帮您做点什么？");
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

    // Permission is exclusive while approval is pending.
    expect(rendered).not.toContain("正在运行 Bash…");
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
      vi.stubEnv("LINGHUN_TERMINAL_TIER", undefined);
      vi.stubEnv("WT_SESSION", undefined);
      vi.stubEnv("TERM_PROGRAM", undefined);
      vi.stubEnv("TERM", undefined);
      vi.stubEnv("ConEmuPID", undefined);
      vi.stubEnv("CONEMUDIR", undefined);
      vi.stubEnv("MSYSTEM", undefined);
      vi.stubEnv("ALACRITTY_WINDOW_ID", undefined);
      resetTerminalCapabilityCache();
      expect(
        shouldUseInkShell(
          { isTTY: true } as NodeJS.ReadStream,
          { isTTY: true } as NodeJS.WriteStream,
        ),
      ).toBe(true);
      const capability = detectTerminalCapability();
      expect(capability.tier).toBe("basic");
      expect(capability.shiftEnter).toBe(false);
      expect(capability.keyboardProtocols).toEqual(["csi-u", "modifyOtherKeys"]);
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

  it("Windows TTY with TERM still enables extended keyboard reporting on modern Windows", () => {
    if (process.platform !== "win32") return;
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TERMINAL_TIER", undefined);
    vi.stubEnv("WT_SESSION", undefined);
    vi.stubEnv("TERM_PROGRAM", undefined);
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("ConEmuPID", undefined);
    vi.stubEnv("CONEMUDIR", undefined);
    vi.stubEnv("MSYSTEM", undefined);
    vi.stubEnv("ALACRITTY_WINDOW_ID", undefined);
    resetTerminalCapabilityCache();

    const capability = detectTerminalCapability();
    expect(capability.shiftEnter).toBe(false);
    expect(capability.keyboardProtocols).toEqual(["csi-u", "modifyOtherKeys"]);
  });

  it("WT_SESSION enables extended keyboard reporting regardless of platform branch", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TERMINAL_TIER", undefined);
    vi.stubEnv("WT_SESSION", "test-windows-terminal");
    vi.stubEnv("TERM_PROGRAM", undefined);
    vi.stubEnv("TERM", undefined);
    resetTerminalCapabilityCache();

    const capability = detectTerminalCapability();
    expect(capability.tier).toBe("modern");
    expect(capability.shiftEnter).toBe(false);
    expect(capability.keyboardProtocols).toEqual(["csi-u", "modifyOtherKeys"]);
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
    expect(rendered).not.toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    // No "你 >" old REPL prompt
    expect(rendered).not.toContain("你 >");
    expect(rendered).not.toContain("you >");
  });
});

describe("D.13C — TUI Product Shell Final Maturity", () => {
  // =========================================================================
  // P1-1: Plain fallback input area closure
  // =========================================================================

  it("plain fallback task renderer has no fake prompt prefix", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    expect(rendered).not.toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    // No old REPL-style prompts
    expect(rendered).not.toContain("你 >");
    expect(rendered).not.toContain("REPL");
  });

  it("plain fallback Task view has no fake composer prompt line", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), {
      noColor: true,
      width: 80,
      viewMode: "task",
      activity: { phase: "thinking", text: "Thinking…" },
    });
    const rendered = renderPlainShell(view);
    // Task view ends with empty line before readline, no fake "> " prompt
    expect(rendered).not.toContain("> 我能帮您做点什么？");
    expect(rendered).not.toContain("> What can I help");
    // Activity is shown
    expect(rendered).toContain("Thinking…");
  });

  it("forced plain (LINGHUN_TUI_PLAIN=1) does not produce double prompt", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    resetTerminalCapabilityCache();
    // Even with modern tier, if plain is forced, the renderer should not add "> " prefix
    const view = createShellViewModel(createContext(), { noColor: false, width: 80 });
    const rendered = renderPlainShell(view);
    expect(rendered).not.toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
  });

  it("TERM=dumb plain fallback renders without crash and no double prompt", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
  });

  // =========================================================================
  // P2-1: Home setup guidance maturity
  // =========================================================================

  it("setupNeeded=true keeps the default composer placeholder (zh-CN)", () => {
    const view = createShellViewModel(createContext({ language: "zh-CN" }), {
      setupNeeded: true,
      width: 80,
    });
    expect(view.composer.placeholder).toBe("我能帮您做点什么？");
    expect(view.setupHint).toContain("按 Enter");
  });

  it("setupNeeded=true keeps the default composer placeholder (en-US)", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      setupNeeded: true,
      width: 80,
    });
    expect(view.composer.placeholder).toBe("What can I help you with?");
    expect(view.setupHint).toContain("Press Enter");
  });

  it("setupNeeded=false in home mode shows normal placeholder", () => {
    const zhView = createShellViewModel(createContext({ language: "zh-CN" }), {
      setupNeeded: false,
      width: 80,
    });
    const enView = createShellViewModel(createContext({ language: "en-US" }), {
      setupNeeded: false,
      width: 80,
    });
    expect(zhView.composer.placeholder).toBe("我能帮您做点什么？");
    expect(enView.composer.placeholder).toBe("What can I help you with?");
  });

  it("setupNeeded=true in task mode shows setupHint (not placeholder override)", () => {
    const view = createShellViewModel(createContext({ language: "zh-CN" }), {
      setupNeeded: true,
      width: 80,
      viewMode: "task",
    });
    // In task mode, setupHint is shown as a separate hint
    expect(view.setupHint).toContain("按 Enter");
    // Placeholder is normal (not setup-specific)
    expect(view.composer.placeholder).toBe("我能帮您做点什么？");
  });

  it("Task does not show large setupHint block when setupNeeded=true", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), {
      setupNeeded: true,
      width: 80,
    });
    const rendered = renderPlainShell(view);
    // No large "还没有模型配置" block
    expect(rendered).not.toContain("还没有模型配置");
    expect(rendered).not.toContain("我要配置模型");
    expect(rendered).not.toContain("按 Enter 开始配置模型");
    expect(rendered).not.toContain("我能帮您做点什么？");
  });

  it("Task visual structure stays compact with setup hint", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), {
      setupNeeded: true,
      width: 80,
      height: 24,
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).not.toContain("技术普惠会越来越成熟");
    expect(rendered).toContain("─");
    expect(rendered).not.toContain("项目：");
    expect(rendered).not.toContain("模型：");
  });

  // =========================================================================
  // P2-2: Composer multiline Up/Down inline movement
  // =========================================================================

  it("bufferMoveUp moves cursor to previous line preserving column", () => {
    // "hello\nworld" with cursor at end (position 11)
    const buf = createEditBuffer("hello\nworld");
    // cursor is at end of "world" (col=5, row=1)
    const moved = bufferMoveUp(buf);
    // Should move to row=0, col=5 (end of "hello")
    expect(moved.cursor).toBe(5);
  });

  it("bufferMoveUp on first line returns same buffer", () => {
    const buf = createEditBuffer("hello");
    const moved = bufferMoveUp(buf);
    expect(moved.cursor).toBe(buf.cursor);
  });

  it("bufferMoveDown moves cursor to next line preserving column", () => {
    // "hello\nworld" with cursor at position 3 (col=3, row=0)
    const buf = { chars: Array.from("hello\nworld"), cursor: 3 };
    const moved = bufferMoveDown(buf);
    // Should move to row=1, col=3 ("wor|ld")
    expect(moved.cursor).toBe(9); // "hello\n" (6) + 3 = 9
  });

  it("bufferMoveDown on last line returns same buffer", () => {
    const buf = createEditBuffer("hello");
    const moved = bufferMoveDown(buf);
    expect(moved.cursor).toBe(buf.cursor);
  });

  it("bufferMoveUp clamps column to shorter target line", () => {
    // "hi\nhello" with cursor at end of "hello" (position 8, col=5, row=1)
    const buf = createEditBuffer("hi\nhello");
    const moved = bufferMoveUp(buf);
    // Target line "hi" has length 2, so col clamped to 2
    expect(moved.cursor).toBe(2);
  });

  it("bufferMoveDown clamps column to shorter target line", () => {
    // "hello\nhi" with cursor at position 5 (end of "hello", col=5, row=0)
    const buf = { chars: Array.from("hello\nhi"), cursor: 5 };
    const moved = bufferMoveDown(buf);
    // Target line "hi" has length 2, so col clamped to 2
    expect(moved.cursor).toBe(8); // "hello\n" (6) + 2 = 8
  });

  it("multiline Up/Down with CJK characters preserves character column", () => {
    // "你好\n世界啊" — cursor at end of line 2 (position 5, col=3, row=1)
    const buf = createEditBuffer("你好\n世界啊");
    const moved = bufferMoveUp(buf);
    // Target line "你好" has length 2, col clamped to 2
    expect(moved.cursor).toBe(2);
  });

  it("three-line buffer: Up from middle goes to first, Down from middle goes to last", () => {
    // "aaa\nbbb\nccc" with cursor in middle of "bbb" (position 5, col=1, row=1)
    const buf = { chars: Array.from("aaa\nbbb\nccc"), cursor: 5 };
    const movedUp = bufferMoveUp(buf);
    // row=0, col=1 → position 1
    expect(movedUp.cursor).toBe(1);
    const movedDown = bufferMoveDown(buf);
    // row=2, col=1 → "aaa\nbbb\n" (8) + 1 = 9
    expect(movedDown.cursor).toBe(9);
  });

  it("Composer formatComposerRenderLines cursor tracks multiline correctly after move", () => {
    // Simulate: user typed "line1\nline2\nline3", cursor moved up to line2
    const buf = { chars: Array.from("line1\nline2\nline3"), cursor: 8 }; // middle of "line2"
    const { cursorRow, cursorCol } = formatComposerRenderLines({
      buffer: buf,
      placeholder: "placeholder",
      masking: false,
      noColor: false,
    });
    // cursor at row=1 (line2), col=2 ("li|ne2")
    expect(cursorRow).toBe(1);
    expect(cursorCol).toBe(2);
  });

  it("Composer renders multiline input on the editor surface", async () => {
    const source = await readFile(join(SRC_ROOT, "shell", "components", "Composer.tsx"), "utf8");
    expect(source).toContain("computeWrappedInputState");
    expect(source).toContain("layout?: ComposerLayout");
    expect(source).not.toContain("{fitText(line, maxWidth)}");

    const buf = createEditBuffer("line1\nline2");
    const { lines, cursorRow, cursorCol } = formatComposerRenderLines({
      buffer: buf,
      placeholder: "placeholder",
      masking: false,
      noColor: false,
      maxWidth: 80,
    });

    expect(lines[0]).toBe("line1");
    expect(lines[1]).toBe("line2");
    expect(cursorRow).toBe(1);
    expect(cursorCol).toBe(5);
  });

  // =========================================================================
  // Task view maturity closure
  // =========================================================================

  it("Task activity phases map to correct semantic status", () => {
    const ctx = createContext();
    const thinkingActivity = mapRequestActivityToView({
      ...ctx,
      requestActivityPhase: "request_started",
    } as unknown as TuiContext);
    expect(thinkingActivity?.phase).toBe("thinking");

    const toolActivity = mapRequestActivityToView({
      ...ctx,
      requestActivityPhase: "tool_running",
      requestActivityToolName: "Bash",
    } as unknown as TuiContext);
    expect(toolActivity?.phase).toBe("tool_running");
    expect(toolActivity?.text).toContain("Bash");

    const errorActivity = mapRequestActivityToView({
      ...ctx,
      requestActivityPhase: "request_failed",
    } as unknown as TuiContext);
    expect(errorActivity?.phase).toBe("error");

    const completedActivity = mapRequestActivityToView({
      ...ctx,
      requestActivityPhase: "completed",
    } as unknown as TuiContext);
    expect(completedActivity?.phase).toBe("completed");
  });

  it("Task permission card includes risk level and tool-action summary", () => {
    const ctx = createContext();
    const permission = mapPendingApprovalToPermission({
      ...ctx,
      pendingLocalApproval: {
        kind: "model_tool_use",
        toolName: "Bash",
        toolCall: { input: { command: "rm -rf /tmp/test" } },
      },
    } as unknown as TuiContext);
    expect(permission).toBeDefined();
    expect(permission?.toolName).toBe("Bash");
    expect(permission?.risk).toBe("high");
    // D.13L Block 0-B — actionSummary 是主屏唯一展示的"做什么"行。
    expect(permission?.actionSummary).toContain("运行终端命令");
    expect(permission?.actionSummary).toContain("rm -rf /tmp/test");
  });

  it("Task permission card renders with all fields in plain view", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), {
      width: 80,
      permission: {
        toolName: "Write",
        reason: "写入文件需要确认",
        risk: "medium",
        scope: ["src/index.ts"],
        hint: "输入 y 允许 / n 拒绝",
      },
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("[Write]");
    expect(rendered).toContain("[MEDIUM]");
    expect(rendered).toContain("写入文件需要确认");
    expect(rendered).toContain("src/index.ts");
    expect(rendered).toContain("输入 y 允许 / n 拒绝");
  });

  it("Task error/fail/blocked output blocks have distinct semantic status", () => {
    // D.13Q-UX Real Smoke Fix v3：fail 不再由 createOutputBlock 关键词扫描决定。
    // 普通正文（即使含 "error/failed"）一律 status=info；显式 fail 块由调用方
    // （工具运行时 / 错误 reporter）传 status=fail 构造，并保留独立配色。
    const single = createOutputBlock("error: compilation failed", "zh-CN", "out-fail");
    expect(single.status).toBe("info");
    expect(single.kind).toBe("details");

    const normalBlock = createOutputBlock("build succeeded", "zh-CN", "out-ok");
    expect(normalBlock.status).toBe("info");
    expect(normalBlock.kind).toBe("details");

    // 真正的 fail 块由调用方显式构造。
    const explicitFail: ProductBlockViewModel = {
      id: "explicit-fail",
      kind: "error",
      status: "fail",
      title: "Bash failed",
      summary: "exit 1",
      messageKind: "tool_result_error",
    };
    expect(explicitFail.status).toBe("fail");
  });

  it("Task completed(partial) background does not display as PASS", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "bg1", title: "verify", status: "completed", result: "partial" }],
    });
    // completed background is filtered out (only active/problematic shown)
    const bgBlocks = view.blocks.filter((b) => b.id.startsWith("bg-"));
    expect(bgBlocks).toHaveLength(0);
  });

  it("Task output blocks retain at least 3 items for context", () => {
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
    // maxEphemeral=20, so 5 blocks all retained.
    expect(outputBlocks.length).toBeGreaterThanOrEqual(3);
    expect(outputBlocks).toHaveLength(5);
  });

  it("Task Composer in permission pending shows permission placeholder", () => {
    const view = createShellViewModel(createContext({ language: "zh-CN" }), {
      width: 80,
      permission: {
        toolName: "Bash",
        reason: "执行命令",
        risk: "high",
        scope: ["ls"],
        hint: "yes / no",
      },
    });
    expect(view.composer.placeholder).toContain("y 同意");
    expect(view.composer.placeholder).toContain("n 拒绝");
  });

  it("Task narrow width (<60) does not crash and renders correctly", () => {
    const view = createShellViewModel(createContext(), {
      width: 45,
      viewMode: "task",
      activity: { phase: "thinking", text: "正在思考…" },
      outputBlocks: [
        { id: "out-1", kind: "details", status: "info", title: "Output", summary: "ok" },
      ],
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).toContain("正在思考");
  });

  it("Task resize (width change) produces valid render at all widths", () => {
    for (const width of [30, 45, 60, 80, 120]) {
      const view = createShellViewModel(createContext(), {
        width,
        viewMode: "task",
        activity: { phase: "tool_running", text: "Running…" },
        permission: {
          toolName: "Bash",
          reason: "exec",
          risk: "high",
          scope: ["cmd"],
          hint: "y/n",
        },
      });
      const rendered = renderPlainShell(view);
      expect(rendered).toContain("LingHun");
      // No crash, no empty render
      expect(rendered.length).toBeGreaterThan(10);
    }
  });

  // =========================================================================
  // Model setup masking still works
  // =========================================================================

  it("model setup masking still renders correctly after D.13C changes", () => {
    const { lines, cursorCol } = formatComposerRenderLines({
      buffer: createEditBuffer("sk-abc123"),
      placeholder: "Enter API key",
      masking: true,
      noColor: false,
    });
    expect(lines[0]).toContain("*********");
    expect(lines[0]).not.toContain("sk-abc123");
    expect(cursorCol).toBe(9);
  });

  // =========================================================================
  // Home/Task structure non-regression
  // =========================================================================

  it("Task structure: brand → separator without home composer/status tray", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), { width: 80, height: 24 });
    const rendered = renderPlainShell(view);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping
    const ANSI_STRIP = /\x1B\[[0-9;]*m/g;
    const lines = rendered.split("\n").map((l) => l.replace(ANSI_STRIP, ""));

    const brandIdx = lines.findIndex((l) => l.trim() === "LingHun");
    const separatorIdx = lines.findIndex((l) => /^─{40,}$/.test(l.trim()));
    const composerIdx = lines.findIndex((l) => l.includes("我能帮您做点什么？"));
    const statusIdx = lines.findIndex((l) => l.includes("项目："));

    expect(brandIdx).toBeGreaterThanOrEqual(0);
    expect(rendered).not.toContain("技术普惠");
    expect(separatorIdx).toBeGreaterThan(brandIdx);
    expect(composerIdx).toBe(-1);
    expect(statusIdx).toBe(-1);
  });

  it("Task structure: topbar → separator → permission, with activity hidden during approval", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      activity: { phase: "tool_running", text: "Running Bash…", toolName: "Bash" },
      permission: {
        toolName: "Bash",
        reason: "exec cmd",
        risk: "high",
        scope: ["ls -la"],
        hint: "y/n",
      },
    });
    const rendered = renderPlainShell(view);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping
    const ANSI_STRIP = /\x1B\[[0-9;]*m/g;
    const lines = rendered.split("\n").map((l) => l.replace(ANSI_STRIP, ""));

    const brandIdx = lines.findIndex((l) => l.includes("LingHun"));
    const activityIdx = lines.findIndex((l) => l.includes("Running Bash"));
    const permIdx = lines.findIndex((l) => l.includes("[Bash]"));

    expect(brandIdx).toBeGreaterThanOrEqual(0);
    expect(activityIdx).toBe(-1);
    expect(permIdx).toBeGreaterThan(brandIdx);
  });
});

// ===========================================================================
// D.13D foundation: brandWordmark + composer width + anchored cursor parity
// ===========================================================================

describe("D.13D brandWordmark foundation", () => {
  it("returns ['LingHun'] at every width and capability", async () => {
    const { brandWordmark } = await import("./text-utils.js");
    for (const noColor of [true, false]) {
      for (const width of [30, 40, 60, 80, 120, 200]) {
        for (const tier of ["legacy", "basic", "modern"] as const) {
          vi.stubEnv("LINGHUN_TERMINAL_TIER", tier);
          resetTerminalCapabilityCache();
          const cap = (await import("./terminal-capability.js")).detectTerminalCapability();
          const lines = brandWordmark(noColor, width, cap);
          expect(lines).toEqual(["LingHun"]);
          // No empty-string spacers, no version, no ASCII/Unicode art
          expect(lines.some((line) => line === "")).toBe(false);
          expect(lines.some((line) => /v?\d+\.\d+\.\d+/.test(line))).toBe(false);
          expect(lines.some((line) => /[\u2500-\u259F]/.test(line))).toBe(false);
          expect(lines.some((line) => line.includes("|") || line.includes("_"))).toBe(false);
          vi.unstubAllEnvs();
        }
      }
    }
  });
});

describe("D.13D composer width foundation", () => {
  it("Composer maxWidth uses composerMaxWidth(view.width) for all widths", async () => {
    const { composerMaxWidth } = await import("./text-utils.js");
    for (const w of [30, 40, 60, 80, 120, 200]) {
      const cw = composerMaxWidth(w);
      expect(cw).toBeGreaterThanOrEqual(40);
      expect(cw).toBeLessThanOrEqual(80);
    }
  });
});

describe("D.13D anchored cursor + Task region", () => {
  it("Composer renders without crash in task mode (no permission, with activity + blocks)", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), {
      width: 80,
      height: 24,
      viewMode: "task",
      activity: { phase: "tool_running", text: "Running Bash…", toolName: "Bash" },
      outputBlocks: [
        { id: "out-1", kind: "details", status: "info", title: "Output", summary: "ok" },
        { id: "out-2", kind: "details", status: "info", title: "Output", summary: "ok2" },
      ],
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).toContain("Running Bash");
    expect(rendered).toContain("ok");
  });

  it("permission + composer coexist: composer placeholder switches to permission hint", () => {
    const view = createShellViewModel(createContext({ language: "zh-CN" }), {
      width: 80,
      viewMode: "task",
      activity: { phase: "permission_waiting", text: "等待权限确认…" },
      permission: {
        toolName: "Bash",
        reason: "执行命令",
        risk: "high",
        scope: ["ls"],
        hint: "y/n",
      },
    });
    expect(view.composer.placeholder).toContain("y 同意");
    expect(view.composer.placeholder).toContain("Esc");
    expect(view.permission?.toolName).toBe("Bash");
  });

  it("activity + output blocks + composer coexist", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      activity: { phase: "tool_running", text: "Running…" },
      outputBlocks: [{ id: "o1", kind: "details", status: "info", title: "T1", summary: "S1" }],
    });
    expect(view.activity?.phase).toBe("tool_running");
    expect(view.blocks.some((b) => b.id === "o1")).toBe(true);
    expect(view.composer.placeholder.length).toBeGreaterThan(0);
  });

  it("status tray narrow width keeps mandatory items", () => {
    const view = createShellViewModel(createContext(), { width: 40, viewMode: "task" });
    expect(view.status.project).toContain("项目");
    expect(view.status.model).toContain("模型");
    expect(view.status.permission).toContain("权限");
  });

  it("masking model setup keeps cursor column based on masked width", () => {
    const view = createShellViewModel(
      createContext({ pendingModelSetup: { step: "apiKey" } } as Partial<TuiContext>),
      { width: 80 },
    );
    expect(view.composer.masking).toBe(true);
    const { lines, cursorCol } = formatComposerRenderLines({
      buffer: createEditBuffer("sk-secret-key"),
      placeholder: "Enter API key",
      masking: true,
      noColor: false,
    });
    expect(lines[0]).not.toContain("sk-secret");
    expect(cursorCol).toBe(13);
  });

  it("permission pending: composer keeps input ownership (placeholder swap, no fake input)", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      viewMode: "task",
      permission: {
        toolName: "Bash",
        reason: "exec",
        risk: "high",
        scope: ["ls"],
        hint: "y/n",
      },
    });
    expect(view.composer.placeholder).toContain("allow");
    expect(view.composer.placeholder).toContain("deny");
    // Ensure permission placeholder is the only composer hint, no double prompt
    expect(view.composer.placeholder).not.toContain("What can I help you with");
  });
});

describe("D.13D Final Closure — interaction shell", () => {
  it("home keeps the default placeholder when setupNeeded=true (no override)", () => {
    const view = createShellViewModel(createContext({ language: "zh-CN" }), {
      setupNeeded: true,
      width: 80,
    });
    expect(view.composer.placeholder).toBe("我能帮您做点什么？");
    expect(view.composer.taskPlaceholder).toContain("继续输入");
    expect(view.composer.setupActive).toBe(false);
    expect(view.composer.setupStep).toBeUndefined();
  });

  it("composer surfaces a step label and step-specific placeholder when model setup is active", () => {
    const view = createShellViewModel(
      createContext({
        language: "zh-CN",
        pendingModelSetup: { step: "apiKey" },
      } as Partial<TuiContext>),
      { width: 80 },
    );
    expect(view.composer.setupActive).toBe(true);
    expect(view.composer.setupStep).toContain("API Key");
    expect(view.composer.placeholder).toContain("API Key");
    expect(view.composer.masking).toBe(true);
  });

  it("baseUrl/model/reasoning/auxModel/confirm setup steps each map to a distinct label", () => {
    const steps = ["baseUrl", "model", "reasoning", "auxModel", "confirm"] as const;
    const labels = steps.map((step) => {
      const view = createShellViewModel(
        createContext({
          language: "zh-CN",
          pendingModelSetup: { step },
        } as Partial<TuiContext>),
        { width: 80 },
      );
      return view.composer.setupStep;
    });
    // All 5 labels should be distinct, non-empty strings.
    expect(new Set(labels).size).toBe(steps.length);
    for (const label of labels) {
      expect(typeof label).toBe("string");
      expect(label && label.length > 0).toBe(true);
    }
  });

  it("permission placeholder takes precedence over setup placeholder", () => {
    const view = createShellViewModel(
      createContext({
        pendingModelSetup: { step: "apiKey" },
        pendingLocalApproval: {
          kind: "model_tool_use",
          toolName: "Bash",
          toolCall: { input: { command: "ls" } },
        },
      } as Partial<TuiContext>),
      {
        width: 80,
        permission: {
          toolName: "Bash",
          reason: "执行命令",
          risk: "high",
          scope: ["ls"],
          hint: "y / n",
        },
      },
    );
    // permission placeholder wins over setup
    expect(view.composer.placeholder).toContain("y 同意");
    // setupActive is still true so step label can render too
    expect(view.composer.setupActive).toBe(true);
  });

  it("Task Ink render does NOT show brand wordmark, status appears as footer", async () => {
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
    expect(output.text).not.toContain("LingHun");
    expect(output.text).toContain("默认模式");
    expect(output.text).toContain("模型");
    expect(output.text).toContain("索引");
    expect(output.text).not.toContain("费用");
    expect(output.text).not.toContain("项目：");
    // task placeholder used
    expect(output.text).toContain("继续输入…");
  });

  it("Task Ink render still hides home brand wordmark", async () => {
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
    expect(output.text).not.toContain("LingHun");
    expect(output.text).toContain("继续输入…");
  });

  it("useAnchoredCursor recalculates after layout commits so parent-chain moves do not drift", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/useAnchoredCursor.ts"), "utf8");
    expect(source).not.toContain("useEffect(");
    expect(source).not.toContain("useInsertionEffect(");
    expect(source).toContain("useLayoutEffect(");
    expect(source).toContain("setCommittedPosition");
    expect(source).toContain("samePosition(previous, next)");
    expect(source).toContain("setCursorPosition(");
  });
});

describe("D.13D rework — TaskWorkspace footer + bare slash + Shift+Tab + permission focus", () => {
  it("task-only view carries taskFooter", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    expect(view.viewMode).toBe("task");
    expect(view.taskFooter).toBeDefined();
  });

  it("task view exposes taskFooter with permission mode + index, no [Linghun] 会话 noise", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      activity: { phase: "thinking", text: "正在思考…" },
    });
    expect(view.taskFooter).toBeDefined();
    expect(view.taskFooter?.permissionMode).toBe("○ 默认模式");
    expect(view.taskFooter?.index).toContain("索引");
    // Critical: TaskFooter must not pull in the noisy session/model/cache/gate/bg line.
    expect(view.taskFooter?.permissionMode ?? "").not.toContain("[Linghun]");
    expect(view.taskFooter?.permissionMode ?? "").not.toContain("会话");
  });

  it("task footer does not carry running task progress or elapsed time", () => {
    const view = createShellViewModel(
      createContext({
        backgroundTasks: [
          {
            status: "running",
            currentStep: "workflow agent running step",
            startedAt: new Date(Date.now() - 12_000).toISOString(),
          },
        ],
      } as Partial<TuiContext>),
      {
        width: 120,
        viewMode: "task",
        activity: { phase: "tool_running", text: "正在运行 Bash…", toolName: "Bash" },
      },
    );
    const footer = view.taskFooter as unknown as Record<string, unknown>;
    expect(footer.task).toBeUndefined();
    expect(footer.elapsed).toBeUndefined();
    expect(Object.values(footer).join(" ")).not.toContain("workflow agent running step");
    expect(Object.values(footer).join(" ")).not.toContain("正在运行 Bash");
  });

  it("Phase 6.6: task footer does NOT show workspaceStatus / runtimeStatus by default (moved to /details /status path)", () => {
    const view = createShellViewModel(createContext(), {
      width: 120,
      viewMode: "task",
      backgroundSummaries: [
        {
          id: "job-724a5c-worker",
          kind: "job",
          title: "Job task-724a5c-worker",
          status: "stale",
          currentStep: "stale/resumable",
          progress: { completed: 0, total: 1 },
        },
      ],
    });

    expect(view.taskFooter?.workspaceStatus).toBeUndefined();
    expect(view.taskFooter?.runtimeStatus).toBeUndefined();
    expect(view.taskRuntimeSummary).toBeUndefined();
  });

  it("Phase 6.6: task footer stays minimal even with background summaries (workspace/runtime details are opt-in)", () => {
    const view = createShellViewModel(createContext(), {
      width: 120,
      viewMode: "task",
      backgroundSummaries: [
        {
          id: "job-724a5c-worker",
          kind: "job",
          title: "Job task-724a5c-worker",
          status: "blocked",
          currentStep: "needs handoff repair",
          progress: { completed: 0, total: 1 },
        },
      ],
    });

    expect(view.taskFooter?.workspaceStatus).toBeUndefined();
    expect(view.taskFooter?.runtimeStatus).toBeUndefined();
    // Footer still has default-visible fields: permission mode, model, index.
    expect(view.taskFooter?.permissionMode).toBeDefined();
    expect(view.taskFooter?.model).toBeDefined();
    expect(view.taskFooter?.index).toBeDefined();

    const rendered = renderPlainShell(view);
    expect(rendered).not.toContain("工作树：");
    expect(rendered).not.toContain("后台 1");
    expect(rendered).not.toContain("后台：1");
    expect(rendered).not.toContain("后台:1");
    expect(rendered).not.toContain("阻塞 1");
    expect(rendered).not.toContain("/background");
  });

  it("D13E-P3: index 'unknown' renders as '索引?' / 'Index?' (no 'unknown' leak)", () => {
    // 显式注入 index.status="unknown"，确保 footer 走 unknown 分支。
    const zhView = createShellViewModel(
      createContext({ index: { status: "unknown" } } as Partial<TuiContext>),
      { width: 80, viewMode: "task" },
    );
    expect(zhView.taskFooter?.index).toBe("索引?");
    expect(zhView.taskFooter?.index ?? "").not.toContain("unknown");

    const enView = createShellViewModel(
      createContext({ language: "en-US", index: { status: "unknown" } } as Partial<TuiContext>),
      { width: 80, viewMode: "task" },
    );
    expect(enView.taskFooter?.index).toBe("Index?");
    expect(enView.taskFooter?.index ?? "").not.toContain("unknown");
  });

  it("D13E-P3 / D.13Q-UX: StatusFooter places cyclePermHint between permissionMode and right segments", async () => {
    const { readFile } = await import("node:fs/promises");
    // D.13Q-UX：旧的 ShellApp.TaskFooter 已迁到独立 StatusFooter 组件，
    // permissionMode/cyclePermHint 顺序与配色断言指向新文件。
    const source = await readFile(join(SRC_ROOT, "shell/components/StatusFooter.tsx"), "utf8");
    const permIdx = source.indexOf("footer.permissionMode");
    const hintIdx = source.indexOf("footer.cyclePermHint");
    expect(permIdx).toBeGreaterThan(0);
    expect(hintIdx).toBeGreaterThan(permIdx);
    // cyclePermHint 是操作提示，不得染 status.fail 红色。
    const cyclePermHintSnippet = source.slice(
      Math.max(0, source.indexOf("footer.cyclePermHint") - 120),
      source.indexOf("footer.cyclePermHint") + 220,
    );
    expect(cyclePermHintSnippet).not.toContain("theme.status.fail");
    // 右栏默认渲染 model · cache · index · reasoning；cost 不进默认 task footer，避免费用估算误导。
    expect(source).toContain("rightSegments");
    expect(source).toContain('key: "cache"');
    expect(source).toContain('key: "index"');
    expect(source).toContain('key: "reasoning"');
    expect(source).not.toContain("footer.cost");
    expect(source.indexOf("footer.workspaceStatus")).toBeLessThan(
      source.indexOf("footer.runtimeStatus"),
    );
    expect(source).not.toContain("footer.task");
    expect(source).not.toContain("footer.elapsed");
  });

  it("D13E-P3: reasoningLevel + reasoningSent surface as 'Reasoning X' / '推理 X' in footer", () => {
    const zhView = createShellViewModel(createContext(), {
      width: 120,
      viewMode: "task",
      reasoningLevel: "High",
      reasoningSent: true,
    });
    expect(zhView.taskFooter?.reasoning).toBe("推理 High");

    const enView = createShellViewModel(createContext({ language: "en-US" }), {
      width: 120,
      viewMode: "task",
      reasoningLevel: "High",
      reasoningSent: true,
    });
    expect(enView.taskFooter?.reasoning).toBe("Reasoning High");

    // reasoningSent=false 时不露出，避免 "推理 ignored" 这种假信号污染 1 行 footer。
    const dropped = createShellViewModel(createContext(), {
      width: 120,
      viewMode: "task",
      reasoningLevel: "High",
      reasoningSent: false,
    });
    expect(dropped.taskFooter?.reasoning).toBeUndefined();

    // 没有 level 时也不露出。
    const noLevel = createShellViewModel(createContext(), { width: 120, viewMode: "task" });
    expect(noLevel.taskFooter?.reasoning).toBeUndefined();
  });

  it("D.13K: anthropic_messages provider + reasoningLevel=High → footer 显示 '推理 High'", () => {
    // view-model 自身不解析 provider，由 runInkShell / runPlainTui 上游传 reasoningLevel +
    // reasoningSent。本用例验证 anthropic_messages 路径下 reasoningSent=true 同样会触发
    // footer 显示，与 responses / permissive_openai_compatible 行为对齐。
    const view = createShellViewModel(createContext(), {
      width: 120,
      viewMode: "task",
      reasoningLevel: "High",
      reasoningSent: true,
    });
    expect(view.taskFooter?.reasoning).toBe("推理 High");
  });

  it("setupHint NO LONGER routes through taskFooter.hint (footer stays 1-line minimal)", () => {
    // D.13D 收尾：长 setup 句子不再灌入 footer.hint，避免任务页底部出现冗长说明。
    // setupHint 仍然存在于 ShellViewModel.setupHint，由 HomeLayout 在主屏单独显示。
    const view = createShellViewModel(createContext(), {
      setupNeeded: true,
      width: 120,
      viewMode: "task",
    });
    expect(view.setupHint).toBeDefined();
    expect(view.setupHint).toContain("按 Enter");
    expect(view.taskFooter?.hint).toBeUndefined();
  });

  it("setup hint suppressed at every pendingModelSetup.step (apiKey/baseUrl/model/reasoning/auxModel/confirm)", () => {
    const steps = ["apiKey", "baseUrl", "model", "reasoning", "auxModel", "confirm"] as const;
    for (const step of steps) {
      const view = createShellViewModel(
        createContext({ pendingModelSetup: { step } } as Partial<TuiContext>),
        { setupNeeded: true, width: 120, viewMode: "task" },
      );
      // 配置流程进行中：setupHint 与 taskFooter.hint 都必须为空，
      // 让 composer 的 step 标签 + step placeholder 成为唯一信源。
      expect(view.setupHint).toBeUndefined();
      expect(view.taskFooter?.hint).toBeUndefined();
    }
  });

  it("setup hint also suppressed in pending viewMode while a setup step is active", () => {
    // Ink 提交后第一帧 viewMode='pending'：只要 pendingModelSetup.step 已经存在，
    // hint 就必须为空，避免旧 hint 与 step 标签同屏闪现。
    const view = createShellViewModel(
      createContext({ pendingModelSetup: { step: "baseUrl" } } as Partial<TuiContext>),
      { setupNeeded: true, width: 120, viewMode: "pending" },
    );
    expect(view.setupHint).toBeUndefined();
    expect(view.taskFooter?.hint).toBeUndefined();
  });

  it("setup hint re-surfaces in setupHint after pendingModelSetup is cleared (taskFooter.hint stays empty)", () => {
    const view = createShellViewModel(createContext({} as Partial<TuiContext>), {
      setupNeeded: true,
      width: 120,
      viewMode: "task",
    });
    expect(view.setupHint).toBeDefined();
    // C 改动后 footer 不再承载 setupHint。setupHint 仍然在 ShellViewModel.setupHint
    // 由主屏渲染（HomeLayout），任务页 footer 永远保持 1 行 permission · index。
    expect(view.taskFooter?.hint).toBeUndefined();
  });

  it("bare slash '/' surfaces common commands while prefix search keeps advanced commands reachable", async () => {
    const { BARE_SLASH_SUGGESTION_SLASHES, getCoreSlashCandidates, getSlashPrefixCandidates } =
      await import("../slash-dispatch.js");
    const candidates = getCoreSlashCandidates();
    const slashes = candidates.map((c) => c.slash);
    expect(slashes).toEqual([...BARE_SLASH_SUGGESTION_SLASHES]);
    expect(slashes.length).toBeGreaterThanOrEqual(10);
    expect(slashes.length).toBeLessThanOrEqual(15);
    expect(slashes).not.toContain("/bash");
    expect(slashes).not.toContain("/batch");
    expect(slashes).not.toContain("/write");

    const baCandidates = getSlashPrefixCandidates("/ba").map((c) => c.slash);
    expect(baCandidates).toContain("/background");
    expect(baCandidates).toContain("/bash");
  });

  it("D.13P slash prefix candidates pull from full user-visible registry, not just default-help", async () => {
    const { getSlashPrefixCandidates } = await import("../slash-dispatch.js");

    const pCandidates = getSlashPrefixCandidates("/p").map((c) => c.slash);
    expect(pCandidates).toContain("/permissions");
    expect(pCandidates).toContain("/plugins");
    expect(pCandidates).toContain("/plan");
    expect(pCandidates).toContain("/problems");

    const caCandidates = getSlashPrefixCandidates("/ca").map((c) => c.slash);
    expect(caCandidates).toContain("/cache");
    expect(caCandidates).toContain("/cache-log");

    const skCandidates = getSlashPrefixCandidates("/sk").map((c) => c.slash);
    expect(skCandidates).toContain("/skills");

    const wCandidates = getSlashPrefixCandidates("/w").map((c) => c.slash);
    expect(wCandidates).toContain("/workflows");
    expect(wCandidates).toContain("/write");
  });

  it("D.13P slash prefix candidates are uncapped and exclude hidden /status", async () => {
    const { getSlashPrefixCandidates } = await import("../slash-dispatch.js");
    const sCandidates = getSlashPrefixCandidates("/s");
    expect(sCandidates.length).toBeGreaterThan(0);
    // /status is registered with userVisible=false; it must not surface even
    // when the prefix exactly matches.
    const statusCandidates = getSlashPrefixCandidates("/status").map((c) => c.slash);
    expect(statusCandidates).not.toContain("/status");
  });

  it("D.13P slash candidates render in column-aligned format (no em dash)", async () => {
    const { formatColumnAlignedCandidates, getSlashPrefixCandidates } = await import(
      "../slash-dispatch.js"
    );
    const candidates = getSlashPrefixCandidates("/p");
    expect(candidates.length).toBeGreaterThan(0);
    const lines = formatColumnAlignedCandidates(candidates, "zh-CN");
    expect(lines.length).toBe(candidates.length);
    for (const line of lines) {
      // No em-dash separator and no leading "- " bullet.
      expect(line).not.toContain(" — ");
      expect(line.startsWith("- ")).toBe(false);
      // Two-column layout: slash followed by run of spaces, then title.
      expect(line).toMatch(/^\/[a-z][a-z-]*\s{2,}/);
    }
  });

  it("D.13P /help short hint mentions /help all so users know hidden commands still work", async () => {
    const { formatCatalogHelp } = await import("../slash-dispatch.js");
    const zh = formatCatalogHelp("zh-CN", "default", false, "short");
    expect(zh).toContain("/help all");
    expect(zh).toContain("未显示不等于不能用");
    const en = formatCatalogHelp("en-US", "default", false, "short");
    expect(en).toContain("/help all");
    expect(en).toContain("Hidden commands still work");
  });

  it("Pre-Smoke 5 /help all is generated from the user-visible command registry", async () => {
    const { formatCatalogHelp } = await import("../slash-dispatch.js");
    const { getUserVisibleCommandCapabilities } = await import("../natural-command-bridge.js");

    const zh = formatCatalogHelp("zh-CN", "default", false, "all");
    const en = formatCatalogHelp("en-US", "default", false, "all");

    for (const command of getUserVisibleCommandCapabilities()) {
      expect(zh).toContain(command.slash);
      expect(en).toContain(command.slash);
    }
    expect(zh).toContain("可用命令（来自命令 registry）");
    expect(en).toContain("Available commands (registry-backed)");
  });

  it("D.13P-S latestOutputNext promotes Ctrl+O over /details in zh-CN and en-US", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/view-model.ts"), "utf8");
    // 主屏 latestOutput next-action：Ctrl+O 必须出现在 /details 之前，且 /details 仍保留为备用。
    const zhMatch = source.match(
      /latestOutputNext:\s*`按 \$\{TOGGLE_DETAILS_KEYBIND\} 查看完整运行时输出（或 \/details）。`/,
    );
    expect(zhMatch).not.toBeNull();
    const enMatch = source.match(
      /latestOutputNext:\s*`Press \$\{TOGGLE_DETAILS_KEYBIND\} for full runtime output \(or \/details\)\.`/,
    );
    expect(enMatch).not.toBeNull();
  });

  it("D.13P-S toolErrorRetryHint promotes Ctrl+O over /details in zh-CN and en-US", async () => {
    const source = await readFile(join(SRC_ROOT, "shell/view-model.ts"), "utf8");
    expect(source).toContain("按 ${TOGGLE_DETAILS_KEYBIND} 查看最近一次失败输出（或 /details）");
    expect(source).toContain(
      "Press ${TOGGLE_DETAILS_KEYBIND} for the latest failure output (or /details)",
    );
  });

  it("ShellInputEvent type union includes cycle-permission-mode for Shift+Tab", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/types.ts"), "utf8");
    expect(source).toContain('"cycle-permission-mode"');
  });

  it("Composer hides anchored cursor while permission is active (permission is sole focus owner)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    expect(source).toContain("useAnchoredCursor(null, anchorRef, capability)");
    expect(source).toContain("permissionActive && view.permission ?");
    expect(source).toContain(") : (\n        <>\n          {showSuggestions ? (");
    expect(source).not.toContain("const showInlineCursor = !permissionActive && index === cursorRow");
  });

  it("Composer Shift+Tab emits cycle-permission-mode (not raw escape sequences)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    // Shift+Tab path uses Ink's key.tab && key.shift, not raw \x1b[Z parsing.
    expect(source).toContain('type: "cycle-permission-mode"');
    expect(source).not.toContain("\\x1b[Z");
  });

  it("/model handler no longer calls writeStatus (Task-mode denoise)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "model-command-runtime.ts"), "utf8");
    // Locate the handleModelCommand body and verify the closing writeStatus
    // call was removed. The function body ends right after the
    // "/model doctor" hint line.
    const fnStart = source.indexOf("async function handleModelCommand(");
    expect(fnStart).toBeGreaterThan(0);
    // Find the next top-level "async function" — the body ends before it.
    const nextFn = source.indexOf("async function ", fnStart + 30);
    const body = source.slice(fnStart, nextFn);
    expect(body).toContain("formatModelRouteSummary");
    expect(body).not.toMatch(/^\s*writeStatus\(output, context\);\s*$/m);
  });

  it("ShellApp TaskLayout keeps one transcript viewport and the pinned composer band", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    const taskLayoutStart = source.indexOf("function TaskLayout(");
    expect(taskLayoutStart).toBeGreaterThan(0);
    const nextFn = source.indexOf("function ", taskLayoutStart + 20);
    const body = source.slice(taskLayoutStart, nextFn);
    expect(body).toContain("<TranscriptViewport");
    expect(body).toContain("virtualRange={view.transcriptVirtualRange}");
    expect(body).toContain("<MouseInputRouter");
    expect(body).toContain("transcript-scroll-measure");
    expect(body).toContain("transcript-viewport-geometry");
    expect(body).toContain('overflow="hidden"');
    expect(source).not.toContain("TASK_RECENT_TAIL_BLOCKS");
    expect(body).toContain("mergeTranscriptBlocks(view.staticHistoryBlocks ?? [], view.blocks)");
    expect(body).not.toContain("recentStaticBlocks");
    expect(body).not.toContain("currentBlocks");
    expect(body).toContain("visibleTranscriptBlocks");
    expect(source).toContain("transcriptBlocks.map(");
    expect(source).toContain("function mergeTranscriptBlocks(");
    expect(body).toContain("<TranscriptViewport");
    expect(body).not.toContain("items={nativeTranscript.staticBlocks}");
    expect(source).not.toContain("function TaskInlineFrame(");
    expect(source).not.toContain("useNativeTranscriptWindow");
    expect(source).not.toContain("nativeTranscript.liveBlocks");
    expect(source).not.toContain("NATIVE_TRANSCRIPT_LIVE_BLOCKS");
    expect(body).toContain("<UnseenMessagePill");
    expect(body).toContain("<TaskBottomPane");
    expect(body).toContain("contentWidth={contentWidth}");
    expect(body).toContain("height={frameHeight}");
    expect(body).toContain("terminalFrameTop");
    expect(body).toContain("flexGrow={1}");
    expect(body).toContain("minHeight={0}");
    const bottomPaneSource = await readFile(
      join(SRC_ROOT, "shell/components/TaskBottomPane.tsx"),
      "utf8",
    );
    expect(bottomPaneSource).toContain("<ProductBlock");
    expect(bottomPaneSource).toContain("<Composer");
    expect(bottomPaneSource).toContain("layout={taskComposerLayout(view.width)}");
    const outerWrapper = body.split("\n").slice(0, 4).join("\n");
    expect(outerWrapper).not.toContain('alignItems="center"');
  });

  it("multiAgent workflow does not show '工作流已完成' — uses collaboration terminology", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "model-tool-runtime.ts"), "utf8");
    const fnStart = source.indexOf("function formatControlToolPrimaryText(");
    expect(fnStart).toBeGreaterThan(0);
    const fnEnd = source.indexOf("\nfunction ", fnStart + 30);
    const body = source.slice(fnStart, fnEnd);
    expect(body).toContain("record.multiAgent");
    expect(body).toContain("多智能体协作已返回结果");
    expect(body).toContain("Multi-agent collaboration returned results");
    expect(body).toContain("多智能体协作返回了部分结果，主链继续整理");
    expect(body).not.toMatch(/if \(status === "completed"\) return zh \? "工作流已完成/);
  });

  it("workflow result=partial must not be displayed as success/completed", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "model-tool-runtime.ts"), "utf8");
    const fnStart = source.indexOf("function formatControlToolPrimaryText(");
    const fnEnd = source.indexOf("\nfunction ", fnStart + 30);
    const body = source.slice(fnStart, fnEnd);
    expect(body).toContain('status === "partial"');
    expect(body).toContain("部分完成");
    expect(body).toContain("partially completed");
  });

  it("deriveBackgroundActivityFallback shows multiAgent collaboration text instead of workflow", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/view-model.ts"), "utf8");
    const fnStart = source.indexOf("function deriveBackgroundActivityFallback(");
    expect(fnStart).toBeGreaterThan(0);
    const fnEnd = source.indexOf("\nfunction ", fnStart + 30);
    const body = source.slice(fnStart, fnEnd);
    expect(body).toContain("multiAgent");
    expect(body).toContain("多智能体协作进行中");
    expect(body).toContain("Multi-agent collaboration running");
  });

  it("classifyToolGroupingBlock recognizes multiAgent collaboration text as 'agent' grouping", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/view-model.ts"), "utf8");
    const fnStart = source.indexOf("function classifyToolGroupingBlock(");
    expect(fnStart).toBeGreaterThan(0);
    const fnEnd = source.indexOf("\nfunction ", fnStart + 30);
    const body = source.slice(fnStart, fnEnd);
    expect(body).toContain("多智能体协作");
    expect(body).toContain("Multi-agent collaboration");
  });

  it("Composer no longer carries SGR wheel handling in the input path", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    expect(source).not.toContain("parseSgrMouseEvent(input)");
    expect(source).not.toContain("isTranscriptWheelTarget(mouse, view.transcriptViewportGeometry)");
    expect(source).not.toContain('mouse?.button === "wheel-up"');
    expect(source).not.toContain('mouse?.button === "wheel-down"');
    expect(source).not.toContain("if (isSgrMouseInput(input))");
  });

  it("transcript measurement and geometry events only rerender on actual state changes", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "index.ts"), "utf8");
    expect(source).toContain("isSameTranscriptScrollState(previous, next)");
    expect(source).toContain("isSameTranscriptViewportGeometry");
    expect(source).toContain("context.transcriptViewportGeometry, event.geometry");
    expect(source).toContain("context.transcriptScrollState = next");
  });

  it("ink slash submits do not enter the natural request pending path", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "index.ts"), "utf8");
    const submitStart = source.indexOf('if (event.type !== "submit")');
    const slashSubmit = source.indexOf('if (event.text.trim().startsWith("/"))', submitStart);
    const naturalPending = source.indexOf("submittedPending = true", submitStart);

    expect(submitStart).toBeGreaterThan(0);
    expect(slashSubmit).toBeGreaterThan(submitStart);
    expect(naturalPending).toBeGreaterThan(slashSubmit);
  });

  it("model-facing control tools restore any existing command panel after internal runtime calls", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "model-tool-runtime.ts"), "utf8");
    expect(source).toContain("const previousCommandPanelState = context.commandPanelState");
    expect(source).toContain("context.commandPanelState = previousCommandPanelState");
  });

  it("TaskLayout renders a task composer separator and keeps footer surfaces separated", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      join(SRC_ROOT, "shell/components/TaskBottomPane.tsx"),
      "utf8",
    );

    expect(source).toContain("<Composer");
    expect(source).toContain("layout={taskComposerLayout(view.width)}");
    expect(source).toContain('width={cw} paddingTop={allocation.mode === "full" ? 1 : 0}');
    expect(source).not.toContain("const composerRule = lineChar(noColor, capability).repeat(cw)");
    expect(source).not.toContain("{composerRule}");
    expect(source).not.toContain("width={cw} paddingX={1}");
    expect(source).toContain("view.taskRuntimeSummary");
    expect(source).toContain("block={view.taskRuntimeSummary}");
    expect(source.indexOf("<NotificationStack")).toBeLessThan(source.indexOf("<Composer"));
    expect(source.indexOf("<StatusFooter")).toBeGreaterThan(source.indexOf("<Composer"));
    expect(source.indexOf("<AgentProgressTree")).toBeLessThan(source.indexOf("<Composer"));
    expect(source.indexOf("<WorkflowProgressView")).toBeLessThan(
      source.indexOf("<Composer"),
    );
    expect(source).not.toContain(
      "`${view.taskRuntimeSummary.title}: ${view.taskRuntimeSummary.summary}`",
    );
  });

  it("D.14D-C2: TaskLayout wires transcript viewport and mouse router", async () => {
    const { readFile } = await import("node:fs/promises");
    const shellSource = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    const viewportSource = await readFile(
      join(SRC_ROOT, "shell/components/ScrollViewport.tsx"),
      "utf8",
    );
    expect(shellSource).toContain('from "./ScrollViewport.js"');
    expect(shellSource).toContain('from "./MouseInputRouter.js"');
    expect(shellSource).toContain("<TranscriptViewport");
    expect(shellSource).toContain("<MouseInputRouter");
    expect(shellSource).toContain('type: "transcript-scroll-measure"');
    expect(shellSource).toContain('type: "transcript-viewport-geometry"');
    expect(viewportSource).toContain("virtualRange?: TranscriptVirtualRangeView");
    expect(viewportSource).toContain('overflow="hidden"');
  });

  it("Phase 7.18 source: controller records measured block heights into the same cache", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "index.ts"), "utf8");
    const typesSource = await readFile(join(SRC_ROOT, "shell/types.ts"), "utf8");
    // The event type is defined in types and handled by the controller in index.ts.
    expect(typesSource).toContain('type: "transcript-block-measure"');
    expect(source).toContain('event.type === "transcript-block-measure"');
    expect(source).toContain("context.transcriptBlockHeightCache ??= {}");
    expect(source).toContain("context.transcriptBlockHeightCache[event.id]");
  });

  it("Phase 2 source: high-frequency transcript updates share one frame request path", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "index.ts"), "utf8");
    const shellAppSource = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    const frameStart = source.indexOf("const requestShellFrame = (): void =>");
    const scrollStart = source.indexOf('// ─── Main transcript scroll', frameStart);
    const scrollEnd = source.indexOf("// ─── D.13E Step 2 修正 #2", scrollStart);
    const scrollSlice = source.slice(scrollStart, scrollEnd);

    expect(frameStart).toBeGreaterThan(0);
    expect(scrollStart).toBeGreaterThan(frameStart);
    expect(source).toContain("const shellOutput = new ShellBlockOutput(");
    expect(source).toContain("createTerminalFirstAssistantSink(output,");
    expect(source).toContain("columns: () => readOutputColumns(output)");
    expect(source).toContain("context.shellRerender = requestShellFrame;");
    expect(scrollSlice).toContain('if (event.type === "transcript-scroll")');
    expect(scrollSlice).toContain('if (event.type === "transcript-scroll-measure")');
    expect(scrollSlice).toContain('if (event.type === "transcript-block-measure")');
    expect(scrollSlice).toContain('if (event.type === "transcript-viewport-geometry")');
    expect(scrollSlice).toContain('if (event.type === "transcript-scroll-end")');
    expect(scrollSlice).toContain('if (event.type === "transcript-scroll-top")');
    expect(scrollSlice).toContain("requestShellFrame();");
    expect(scrollSlice).not.toContain("await shell?.waitUntilRenderFlush()");

    const tickerStart = source.indexOf("activityTicker = setInterval");
    const tickerEnd = source.indexOf("}, 1000);", tickerStart);
    const tickerSlice = source.slice(tickerStart, tickerEnd);
    expect(tickerSlice).toContain("requestShellFrame();");
    expect(tickerSlice).not.toContain("shell?.rerender()");

    expect(shellAppSource.match(/setInterval/g) ?? []).toHaveLength(1);
    expect(shellAppSource).toContain("const [framePulse, setFramePulse] = useState(0);");
    expect(shellAppSource).toContain("const intervalMs = hasAnimatedActivity ? 100 : 1000;");
    expect(shellAppSource).toContain("frame={framePulse}");
    expect(shellAppSource).not.toContain("setFrame((current) => current + 1)");
  });

  it("Phase 3 source: task and progress surfaces keep bounded stable rows", async () => {
    const { readFile } = await import("node:fs/promises");
    const progressSource = await readFile(join(SRC_ROOT, "shell/progress-views.ts"), "utf8");
    const taskListSource = await readFile(join(SRC_ROOT, "shell/components/TaskListView.tsx"), "utf8");
    const workflowSource = await readFile(
      join(SRC_ROOT, "shell/components/WorkflowProgressView.tsx"),
      "utf8",
    );
    const agentSource = await readFile(
      join(SRC_ROOT, "shell/components/AgentProgressTree.tsx"),
      "utf8",
    );

    expect(progressSource).toContain("const MAX_AGENT_ROWS = 6;");
    expect(progressSource).toContain("const MAX_WORKFLOW_STEPS = 5;");
    expect(progressSource).toContain("hiddenSteps: steps.hiddenPending");
    expect(taskListSource).toContain("const rowText =");
    expect(taskListSource).not.toContain("fitText(`${row.activity}…`");
    expect(workflowSource).toContain("run.hiddenSteps");
    expect(agentSource).toContain("tree.hiddenPending");
  });
});

// ShellBlockOutput streaming assistant block —— assistant_text_delta 多片必须
// 累积到同一条 keep:true block，而不是被 _write 的 ephemeral splice 淘汰。
// 触发场景：sendMessage / streamFinalModelAnswerWithoutTools /
// continueModelAfterToolResults 三处 gateway.stream 循环。
describe("ShellBlockOutput — assistant streaming block", () => {
  const terminalHistoryGeometry = {
    x: 0,
    y: 17,
    width: 80,
    height: 8,
    contentHeight: 8,
    topOffset: 0,
  };
  function makeFakeContext(): TuiContext {
    return createContext({
      language: "zh-CN",
      projectPath: "/tmp",
      sessionId: "test-session",
      lastFullOutput: undefined,
      suppressLastFullOutputCapture: false,
    } as Partial<TuiContext>);
  }

  it("appendAssistantDelta 只更新 live tail；commit tick 再写稳定 ProductBlock", () => {
    vi.useFakeTimers();
    const blocks: ProductBlockViewModel[] = [];
    let renderCount = 0;
    const ctx = makeFakeContext();
    const output = __testCreateShellBlockOutput(ctx, blocks, () => {
      renderCount += 1;
    });

    output.beginAssistantStream("assistant-stream-test-1");
    output.appendAssistantDelta("连");
    expect(blocks.find((b) => b.id === "assistant-stream-test-1")).toBeUndefined();
    output.appendAssistantDelta("接成功\n尾");
    expect(blocks.find((b) => b.id === "assistant-stream-test-1")).toBeUndefined();
    expect(ctx.streamingAssistant).toEqual({
      id: "assistant-stream-test-1",
      text: "连接成功\n尾",
      tailText: "连接成功\n尾",
      committedText: "",
    });
    vi.advanceTimersByTime(16);
    expect(blocks.find((b) => b.id === "assistant-stream-test-1")?.fullText).toBe("连接成功\n");
    expect(ctx.streamingAssistant).toEqual({
      id: "assistant-stream-test-1",
      text: "连接成功\n尾",
      tailText: "尾",
      committedText: "连接成功\n",
    });
    const streamingView = createShellViewModel(ctx, { outputBlocks: blocks, viewMode: "task" });
    expect(streamingView.blocks.find((b) => b.id === "assistant-stream-test-1")?.fullText).toBe(
      "连接成功\n",
    );
    expect(streamingView.streamingAssistantText).toBe("尾");
    output.replaceAssistantBlockContent("assistant-stream-test-1", "连接成功\n尾部完成");
    output.endAssistantStream();

    const streamingBlock = blocks.find((b) => b.id === "assistant-stream-test-1");
    expect(streamingBlock).toBeDefined();
    expect(streamingBlock?.keep).toBe(true);
    expect(streamingBlock?.fullText).toBe("连接成功\n尾部完成");
    expect(streamingBlock?.summary).toBe("连接成功");
    expect(blocks.filter((b) => b.id === "assistant-stream-test-1")).toHaveLength(1);
    expect(ctx.streamingAssistant).toBeUndefined();
    expect(renderCount).toBeGreaterThanOrEqual(4);
  });

  it("appendAssistantDelta 每次只刷新独立 preview，稳定行由 tick 写入 ProductBlock", () => {
    vi.useFakeTimers();
    const blocks: ProductBlockViewModel[] = [];
    let renderCount = 0;
    const ctx = makeFakeContext();
    const output = __testCreateShellBlockOutput(ctx, blocks, () => {
      renderCount += 1;
    });

    output.beginAssistantStream("assistant-stream-complete-line");
    output.appendAssistantDelta("A");
    output.appendAssistantDelta("B");
    expect(blocks.find((b) => b.id === "assistant-stream-complete-line")).toBeUndefined();
    expect(ctx.streamingAssistant?.text).toBe("AB");
    expect(renderCount).toBe(3);

    output.appendAssistantDelta("\nC");
    expect(blocks).toHaveLength(0);
    expect(ctx.streamingAssistant?.text).toBe("AB\nC");
    expect(ctx.streamingAssistant?.tailText).toBe("AB\nC");
    expect(renderCount).toBe(4);

    vi.advanceTimersByTime(16);
    expect(blocks).toHaveLength(1);
    expect(ctx.streamingAssistant?.tailText).toBe("C");
    expect(blocks[0]?.fullText).toBe("AB\n");
    const streamingView = createShellViewModel(ctx, { outputBlocks: blocks, viewMode: "task" });
    expect(
      streamingView.blocks.find((b) => b.id === "assistant-stream-complete-line")?.fullText,
    ).toBe("AB\n");
    expect(streamingView.streamingAssistantText).toBe("C");
    expect(renderCount).toBe(5);

    output.endAssistantStream();
    expect(blocks[0]?.fullText).toBe("AB\nC");
    expect(ctx.streamingAssistant).toBeUndefined();
    expect(renderCount).toBe(6);
  });

  it("endAssistantStream 只 commit 一条正式 assistant block，并清空 streaming preview", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);

    output.beginAssistantStream("assistant-stream-interrupt");
    output.appendAssistantDelta("第一行可见\n第二行半截");
    expect(blocks.find((b) => b.id === "assistant-stream-interrupt")).toBeUndefined();
    expect(ctx.streamingAssistant?.text).toBe("第一行可见\n第二行半截");
    expect(ctx.streamingAssistant?.tailText).toBe("第一行可见\n第二行半截");
    output.endAssistantStream();
    vi.advanceTimersByTime(16);

    const streamingBlock = blocks.find((b) => b.id === "assistant-stream-interrupt");
    expect(blocks.filter((b) => b.id === "assistant-stream-interrupt")).toHaveLength(1);
    expect(streamingBlock?.messageKind).toBe("assistant_text");
    expect(streamingBlock?.fullText).toBe("第一行可见\n第二行半截");
    expect(ctx.transcriptSource?.cells).toHaveLength(1);
    expect(ctx.transcriptSource?.cells[0]?.kind).toBe("assistant");
    expect(ctx.transcriptSource?.cells[0]?.block.fullText).toBe("第一行可见\n第二行半截");
    expect(ctx.streamingAssistant).toBeUndefined();
    expect(ctx.lastFullOutput).toBe("第一行可见\n第二行半截");
  });

  it("普通 writeLine 后再开 streaming block，writeLine 不再被 ephemeral splice 淘汰；keep streaming block 保留", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks);

    // 1) 先开 streaming block —— keep:true
    output.beginAssistantStream("assistant-stream-test-2");
    output.appendAssistantDelta("hello ");
    output.appendAssistantDelta("world\n");
    output.endAssistantStream();

    // 2) 再写两条普通 writeLine（_write 路径）
    output.write("first ephemeral line\n");
    output.write("second ephemeral line\n");

    // streaming block 必须留下，且 fullText 不丢
    const streamingBlock = blocks.find((b) => b.id === "assistant-stream-test-2");
    expect(streamingBlock).toBeDefined();
    expect(streamingBlock?.fullText).toBe("hello world\n");
    // D.13Q-UX Real Smoke Fix v3：ShellBlockOutput 不再做 ephemeral splice，
    // 两条 ephemeral 按 append 时间顺序保留；view-model 才负责 cap 限流。
    const ephemeralBlocks = blocks.filter((b) => !b.keep);
    expect(ephemeralBlocks).toHaveLength(2);
    expect(ephemeralBlocks[0]?.summary).toContain("first ephemeral line");
    expect(ephemeralBlocks[1]?.summary).toContain("second ephemeral line");
  });

  it("appendAssistantDelta 在没有 active streaming block 时回退到 _write（不丢内容）", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks);

    // 没 begin 直接 append —— 走 _write fallback，作为普通 ephemeral 块。
    output.appendAssistantDelta("fallback text");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.keep).toBeFalsy();
    expect(blocks[0]?.summary).toContain("fallback text");
  });

  it("lastFullOutput 只在 final commit 时累计；中途 stable commit 不写入", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);

    output.beginAssistantStream("assistant-stream-test-3");
    output.appendAssistantDelta("连");
    expect(ctx.lastFullOutput).toBeUndefined();
    output.appendAssistantDelta("接成功\n");
    expect(ctx.lastFullOutput).toBeUndefined();
    expect(ctx.streamingAssistant?.tailText).toBe("连接成功\n");
    expect(blocks.find((b) => b.id === "assistant-stream-test-3")).toBeUndefined();
    vi.advanceTimersByTime(16);
    expect(ctx.lastFullOutput).toBeUndefined();
    expect(ctx.streamingAssistant).toEqual({
      id: "assistant-stream-test-3",
      text: "连接成功\n",
      tailText: "",
      committedText: "连接成功\n",
    });
    expect(blocks.find((b) => b.id === "assistant-stream-test-3")?.fullText).toBe("连接成功\n");

    // 切换到 suppress 模式后，新的 delta 不能再覆盖 lastFullOutput。
    ctx.suppressLastFullOutputCapture = true;
    output.appendAssistantDelta("后续\n");
    expect(ctx.lastFullOutput).toBeUndefined();
    output.endAssistantStream();
    expect(ctx.lastFullOutput).toBeUndefined();
  });

  it("final gate discard/replace clears old streaming preview without leaking discarded text", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);

    output.beginAssistantStream("assistant-stream-gate");
    output.appendAssistantDelta("违规旧文本 PASS\n");
    output.discardAssistantBlock("assistant-stream-gate");
    expect(ctx.streamingAssistant).toBeUndefined();
    expect(blocks.find((b) => b.id === "assistant-stream-gate")?.fullText).toBeUndefined();

    output.appendAssistantDelta("安全新文本\n");
    expect(ctx.streamingAssistant?.tailText).toBe("安全新文本\n");
    vi.advanceTimersByTime(16);
    expect(ctx.streamingAssistant).toEqual({
      id: "assistant-stream-gate",
      text: "安全新文本\n",
      tailText: "",
      committedText: "安全新文本\n",
    });
    expect(blocks.find((b) => b.id === "assistant-stream-gate")?.fullText).toBe("安全新文本\n");
    output.replaceAssistantBlockContent("assistant-stream-gate", "最终安全文本");
    expect(ctx.streamingAssistant).toBeUndefined();

    const committed = blocks.find((b) => b.id === "assistant-stream-gate");
    expect(committed?.fullText).toBe("最终安全文本");
    expect(ctx.transcriptSource?.cells).toHaveLength(1);
    expect(ctx.transcriptSource?.cells[0]?.block.fullText).toBe("最终安全文本");
    expect(JSON.stringify(blocks)).not.toContain("违规旧文本");
  });

  it("beginAssistantStream starts a fresh preview so continuation rounds do not glue together", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);

    output.beginAssistantStream("assistant-stream-round-1");
    output.appendAssistantDelta("第一轮 preview\n");
    expect(ctx.streamingAssistant?.tailText).toBe("第一轮 preview\n");
    vi.advanceTimersByTime(16);
    expect(ctx.streamingAssistant).toEqual({
      id: "assistant-stream-round-1",
      text: "第一轮 preview\n",
      tailText: "",
      committedText: "第一轮 preview\n",
    });
    expect(blocks.find((b) => b.id === "assistant-stream-round-1")?.fullText).toBe(
      "第一轮 preview\n",
    );

    output.beginAssistantStream("assistant-stream-round-2");
    expect(ctx.streamingAssistant).toBeUndefined();
    output.appendAssistantDelta("第二轮 preview");
    expect(ctx.streamingAssistant).toEqual({
      id: "assistant-stream-round-2",
      text: "第二轮 preview",
      tailText: "第二轮 preview",
      committedText: "",
    });
    expect(blocks.find((b) => b.id === "assistant-stream-round-1")?.fullText).toBe(
      "第一轮 preview\n",
    );
    expect(ctx.streamingAssistant?.text).not.toContain("第一轮");
  });

  it("commit tick updates stable text and refreshes the live tail boundary", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    let renderCount = 0;
    const output = __testCreateShellBlockOutput(ctx, blocks, () => {
      renderCount += 1;
    });

    output.beginAssistantStream("assistant-stream-invisible-tick");
    output.appendAssistantDelta("A\nB");
    expect(renderCount).toBe(2);

    vi.advanceTimersByTime(16);

    expect(blocks.find((b) => b.id === "assistant-stream-invisible-tick")?.fullText).toBe("A\n");
    expect(ctx.streamingAssistant?.text).toBe("A\nB");
    expect(ctx.streamingAssistant?.tailText).toBe("B");
    expect(renderCount).toBe(3);
  });

  it("holdStableCommit keeps final-answer draft out of stable blocks until replacement", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);

    output.beginAssistantStream("assistant-stream-held-final", { holdStableCommit: true });
    output.appendAssistantDelta("原始最终回答\n第二行");
    vi.advanceTimersByTime(64);

    expect(blocks.find((b) => b.id === "assistant-stream-held-final")).toBeUndefined();
    expect(ctx.lastFullOutput).toBeUndefined();
    expect(ctx.streamingAssistant?.text).toBe("原始最终回答\n第二行");

    output.discardAssistantBlock("assistant-stream-held-final");
    output.appendAssistantDelta("retry 后的原始回答\n");
    vi.advanceTimersByTime(64);
    expect(blocks.find((b) => b.id === "assistant-stream-held-final")).toBeUndefined();
    expect(ctx.lastFullOutput).toBeUndefined();
    expect(ctx.streamingAssistant?.text).toBe("retry 后的原始回答\n");

    output.replaceAssistantBlockContent("assistant-stream-held-final", "清洗后的最终回答");
    output.endAssistantStream();

    const committed = blocks.find((b) => b.id === "assistant-stream-held-final");
    expect(committed?.fullText).toBe("清洗后的最终回答");
    expect(ctx.lastFullOutput).toBe("清洗后的最终回答");
    expect(JSON.stringify(blocks)).not.toContain("原始最终回答");
    expect(JSON.stringify(blocks)).not.toContain("retry 后的原始回答");
  });

  it("holdStableCommit discards a draft when the stream ends without replacement", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const terminalWrites: string[] = [];
    let stagedText = "";
    const output = __testCreateShellBlockOutput(ctx, blocks, () => undefined, {
      stageStableAssistantText: (text) => {
        stagedText += text;
      },
      commitStableAssistantText: () => {
        terminalWrites.push(stagedText);
        stagedText = "";
        return true;
      },
      rollbackStableAssistantText: () => {
        stagedText = "";
      },
    });

    output.beginAssistantStream("assistant-held-end", { holdStableCommit: true });
    output.appendAssistantDelta("unsafe draft before abort\n");
    vi.advanceTimersByTime(64);
    output.endAssistantStream();

    expect(blocks.find((b) => b.id === "assistant-held-end")).toBeUndefined();
    expect(ctx.lastFullOutput).toBeUndefined();
    expect(ctx.streamingAssistant).toBeUndefined();
    expect(stagedText).toBe("");
    expect(terminalWrites).toEqual([]);
  });

  it("holdStableCommit discards an active draft when a new stream id starts", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const terminalWrites: string[] = [];
    let stagedText = "";
    const output = __testCreateShellBlockOutput(ctx, blocks, () => undefined, {
      stageStableAssistantText: (text) => {
        stagedText += text;
      },
      commitStableAssistantText: () => {
        terminalWrites.push(stagedText);
        stagedText = "";
        return true;
      },
      rollbackStableAssistantText: () => {
        stagedText = "";
      },
    });

    output.beginAssistantStream("assistant-held-old", { holdStableCommit: true });
    output.appendAssistantDelta("unsafe draft before fallback\n");
    vi.advanceTimersByTime(64);

    output.beginAssistantStream("assistant-held-new", { holdStableCommit: true });

    expect(blocks.find((b) => b.id === "assistant-held-old")).toBeUndefined();
    expect(ctx.lastFullOutput).toBeUndefined();
    expect(ctx.streamingAssistant?.id).toBeUndefined();
    expect(stagedText).toBe("");
    expect(terminalWrites).toEqual([]);

    output.appendAssistantDelta("new draft\n");
    vi.advanceTimersByTime(64);
    expect(blocks.find((b) => b.id === "assistant-held-new")).toBeUndefined();
    expect(ctx.streamingAssistant?.text).toBe("new draft\n");
  });

  it("terminal-first assistant gate discards held draft on direct end", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const terminalWrites: string[] = [];
    let stagedText = "";
    const output = __testCreateShellBlockOutput(ctx, blocks, () => undefined, {
      stageStableAssistantText: (text) => {
        stagedText += text;
      },
      commitStableAssistantText: (_id, onFlush) => {
        terminalWrites.push(stagedText);
        stagedText = "";
        onFlush?.();
        return true;
      },
      rollbackStableAssistantText: () => {
        stagedText = "";
      },
      commitAssistantTurnBreak: () => {
        terminalWrites.push("<turn-break>");
        return true;
      },
    });

    output.beginAssistantStream("assistant-terminal-first", { holdStableCommit: true });
    output.appendAssistantDelta("A\nB");
    vi.advanceTimersByTime(16);

    expect(stagedText).toBe("");
    expect(terminalWrites).toEqual([]);
    expect(blocks.find((b) => b.id === "assistant-terminal-first")).toBeUndefined();
    const streamingView = createShellViewModel(ctx, { outputBlocks: blocks, viewMode: "task" });
    expect(streamingView.blocks.find((b) => b.id === "assistant-terminal-first")).toBeUndefined();
    expect(streamingView.streamingAssistantText).toBe("A\nB");

    output.endAssistantStream();
    expect(terminalWrites).toEqual([]);
    expect(blocks.find((b) => b.id === "assistant-terminal-first")).toBeUndefined();
    const finalView = createShellViewModel(ctx, { outputBlocks: blocks, viewMode: "task" });
    expect(finalView.blocks.find((b) => b.id === "assistant-terminal-first")).toBeUndefined();
    expect(finalView.streamingAssistantText).toBeUndefined();
    expect(ctx.lastFullOutput).toBeUndefined();
  });

  it("terminal-first assistant gate commits only the final-gate replacement", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const terminalWrites: string[] = [];
    let stagedText = "";
    const output = __testCreateShellBlockOutput(ctx, blocks, () => undefined, {
      stageStableAssistantText: (text) => {
        stagedText += text;
      },
      commitStableAssistantText: () => {
        terminalWrites.push(stagedText);
        stagedText = "";
        return true;
      },
      rollbackStableAssistantText: () => {
        stagedText = "";
      },
    });

    output.beginAssistantStream("assistant-terminal-first-replace", { holdStableCommit: true });
    output.appendAssistantDelta("unsafe draft\n");
    vi.advanceTimersByTime(16);
    expect(blocks.find((b) => b.id === "assistant-terminal-first-replace")).toBeUndefined();
    expect(terminalWrites).toEqual([]);
    output.replaceAssistantBlockContent("assistant-terminal-first-replace", "safe final");

    const view = createShellViewModel(ctx, { outputBlocks: blocks, viewMode: "task" });
    expect(view.blocks.find((b) => b.id === "assistant-terminal-first-replace")?.fullText).toBe(
      "safe final",
    );
    expect(view.streamingAssistantText).toBeUndefined();
    // After replaceAssistantBlockContent the safe text is re-staged so
    // finalizeActiveAssistantStream can commit it to terminal scrollback.
    expect(stagedText).toBe("safe final");
    expect(terminalWrites).toEqual([]);
    output.endAssistantStream();
    expect(terminalWrites).toEqual(["safe final"]);
  });

  it("deduplicates adjacent provider failure error blocks by title and body", () => {
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    let renderCount = 0;
    const output = __testCreateShellBlockOutput(ctx, blocks, () => {
      renderCount += 1;
    });
    const errorOutput = output as unknown as {
      writeErrorLine(text: string, title?: string): void;
    };

    errorOutput.writeErrorLine("模型请求未完成。可运行 /model doctor 查看详情后重试。", "模型请求失败");
    errorOutput.writeErrorLine("模型请求未完成。可运行 /model doctor 查看详情后重试。", "模型请求失败");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.title).toBe("模型请求失败");
    expect(blocks[0]?.messageKind).toBe("tool_result_error");
    expect(renderCount).toBe(2);
  });

  it("terminal-first assistant gate rolls back staged text on discard", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const terminalWrites: string[] = [];
    let stagedText = "";
    const output = __testCreateShellBlockOutput(ctx, blocks, () => undefined, {
      stageStableAssistantText: (text) => {
        stagedText += text;
      },
      commitStableAssistantText: () => {
        terminalWrites.push(stagedText);
        stagedText = "";
        return true;
      },
      rollbackStableAssistantText: () => {
        stagedText = "";
      },
    });

    output.beginAssistantStream("assistant-terminal-first-discard");
    output.appendAssistantDelta("bad\n");
    vi.advanceTimersByTime(16);
    expect(stagedText).toBe("");
    expect(terminalWrites).toEqual([]);

    output.discardAssistantBlock("assistant-terminal-first-discard");

    expect(stagedText).toBe("");
    expect(terminalWrites).toEqual([]);
    expect(blocks.find((b) => b.id === "assistant-terminal-first-discard")).toBeUndefined();
  });

  it("terminal-first assistant gate keeps final text visible in Ink when terminal commit fails", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    let stagedText = "";
    const output = __testCreateShellBlockOutput(ctx, blocks, () => undefined, {
      stageStableAssistantText: (text) => {
        stagedText += text;
      },
      commitStableAssistantText: () => {
        stagedText = "";
        return false;
      },
      rollbackStableAssistantText: () => {
        stagedText = "";
      },
    });

    output.beginAssistantStream("assistant-terminal-first-commit-failed");
    output.appendAssistantDelta("A\nB");
    vi.advanceTimersByTime(16);
    expect(stagedText).toBe("");

    output.endAssistantStream();

    const block = blocks.find((b) => b.id === "assistant-terminal-first-commit-failed");
    expect(block?.terminalOwned).toBeUndefined();
    expect(block?.fullText).toBe("A\nB");
    const finalView = createShellViewModel(ctx, { outputBlocks: blocks, viewMode: "task" });
    expect(
      finalView.blocks.find((b) => b.id === "assistant-terminal-first-commit-failed")?.fullText,
    ).toBe("A\nB");
    expect(finalView.streamingAssistantText).toBeUndefined();
    expect(ctx.lastFullOutput).toBe("A\nB");
    expect(stagedText).toBe("");
  });

  it("native scrollback stable diagnostic blocks leave Ink after commit succeeds", () => {
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const committed: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks, () => undefined, {
      stageStableAssistantText: () => undefined,
      commitStableAssistantText: () => true,
      rollbackStableAssistantText: () => undefined,
      commitStableTranscriptBlock: (block, onFlush) => {
        committed.push(block);
        onFlush?.();
        return true;
      },
    }) as unknown as {
      writeDiagnosticLine?: (text: string) => void;
    };

    output.writeDiagnosticLine?.("MCP status\n- enabled: yes");

    expect(committed).toHaveLength(1);
    expect(committed[0]?.messageKind).toBe("diagnostic");
    // Plan A single ownership: committed block is removed from the Ink array.
    expect(blocks).toHaveLength(0);
    expect(ctx.lastFullOutput).toBe("MCP status\n- enabled: yes");
  });

  it("native scrollback stable diagnostics stay visible in Ink when commit fails", () => {
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks, () => undefined, {
      stageStableAssistantText: () => undefined,
      commitStableAssistantText: () => true,
      rollbackStableAssistantText: () => undefined,
      commitStableTranscriptBlock: () => false,
    }) as unknown as {
      writeDiagnosticLine?: (text: string) => void;
    };

    output.writeDiagnosticLine?.("MCP status\n- enabled: yes");

    expect(blocks[0]?.terminalOwned).toBeUndefined();
    const view = createShellViewModel(ctx, { outputBlocks: blocks, viewMode: "task" });
    expect(view.blocks.find((b) => b.id === blocks[0]?.id)?.messageKind).toBe("diagnostic");
  });

  it("native scrollback stable local command output leaves Ink after commit", () => {
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const committed: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks, () => undefined, {
      stageStableAssistantText: () => undefined,
      commitStableAssistantText: () => true,
      rollbackStableAssistantText: () => undefined,
      commitStableTranscriptBlock: (block, onFlush) => {
        committed.push(block);
        onFlush?.();
        return true;
      },
    }) as unknown as {
      writeLocalCommandOutputLine?: (text: string) => void;
    };

    output.writeLocalCommandOutputLine?.("Tool Bash completed\n- 40 行");

    expect(committed).toHaveLength(1);
    expect(committed[0]?.messageKind).toBe("local_command_output");
    // Plan A single ownership: committed block is removed from the Ink array.
    expect(blocks).toHaveLength(0);
  });

  it("view-model keeps terminal-owned blocks available for non-native projections", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    const ctx = makeFakeContext();
    const block: ProductBlockViewModel = {
      id: "terminal-owned-native",
      kind: "details",
      status: "info",
      title: "",
      summary: "already in terminal",
      fullText: "already in terminal",
      terminalOwned: true,
    };

    const view = createShellViewModel(ctx, { outputBlocks: [block], viewMode: "task" });

    expect(view.blocks.find((b) => b.id === block.id)).toBeDefined();
    vi.unstubAllEnvs();
  });

  it("view-model keeps terminal-owned user text in the canonical projection", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    const ctx = makeFakeContext();
    const block: ProductBlockViewModel = {
      id: "terminal-owned-user",
      kind: "user",
      status: "info",
      title: "你是谁",
      summary: "",
      fullText: "你是谁",
      messageKind: "user_text",
      terminalOwned: true,
    };

    const view = createShellViewModel(ctx, { outputBlocks: [block], viewMode: "task" });

    expect(view.blocks.find((b) => b.id === block.id)).toBeDefined();
    vi.unstubAllEnvs();
  });

  it("view-model preserves older terminal-owned user text instead of filtering by ownership", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    const ctx = makeFakeContext();
    const older: ProductBlockViewModel = {
      id: "older-terminal-owned-user",
      kind: "user",
      status: "info",
      title: "旧消息",
      summary: "",
      fullText: "旧消息",
      messageKind: "user_text",
      terminalOwned: true,
    };
    const newer: ProductBlockViewModel = {
      id: "newer-pending-user",
      kind: "user",
      status: "info",
      title: "新消息",
      summary: "",
      fullText: "新消息",
      messageKind: "user_text",
    };

    const view = createShellViewModel(ctx, { outputBlocks: [older, newer], viewMode: "task" });

    expect(view.blocks.find((b) => b.id === older.id)).toBeDefined();
    expect(view.blocks.find((b) => b.id === newer.id)).toBeDefined();
    vi.unstubAllEnvs();
  });

  it("native scrollback keeps unflushed user text visible as the Ink fallback", () => {
    vi.unstubAllEnvs();
    const ctx = makeFakeContext();
    const block: ProductBlockViewModel = {
      id: "pending-user",
      kind: "user",
      status: "info",
      title: "还没写入终端",
      summary: "",
      fullText: "还没写入终端",
      messageKind: "user_text",
    };

    const view = createShellViewModel(ctx, { outputBlocks: [block], viewMode: "task" });

    expect(view.blocks.find((b) => b.id === block.id)).toBeDefined();
    vi.unstubAllEnvs();
  });

  it("terminal-owned block filtering can be disabled as an explicit compatibility fallback", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_TERMINAL_OWNED_FILTER", "0");
    const ctx = makeFakeContext();
    const block: ProductBlockViewModel = {
      id: "terminal-owned-compat",
      kind: "details",
      status: "info",
      title: "",
      summary: "already in terminal",
      fullText: "already in terminal",
      terminalOwned: true,
    };

    const view = createShellViewModel(ctx, { outputBlocks: [block], viewMode: "task" });

    expect(view.blocks.find((b) => b.id === block.id)).toBeDefined();
    vi.unstubAllEnvs();
  });

  it("native scrollback opt-out keeps terminal-owned blocks in the Ink transcript", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    const ctx = makeFakeContext();
    const block: ProductBlockViewModel = {
      id: "terminal-owned-native-off",
      kind: "details",
      status: "info",
      title: "",
      summary: "fallback visible",
      fullText: "fallback visible",
      terminalOwned: true,
    };

    const view = createShellViewModel(ctx, { outputBlocks: [block], viewMode: "task" });

    expect(view.blocks.find((b) => b.id === block.id)).toBeDefined();
    vi.unstubAllEnvs();
  });

  it("source-backed Ink projection matches the current block projection without changing styles", () => {
    const ctx = makeFakeContext();
    const source = createTranscriptSource();
    const blocks: ProductBlockViewModel[] = [
      {
        id: "source-user",
        kind: "user",
        status: "info",
        title: "现在要怎么做",
        summary: "",
        fullText: "现在要怎么做",
        messageKind: "user_text",
      },
      {
        id: "source-assistant",
        kind: "details",
        status: "info",
        title: "",
        summary: "先保留样式",
        fullText: "先保留样式\n再补 source replay",
        messageKind: "assistant_text",
      },
      {
        id: "source-diagnostic",
        kind: "details",
        status: "info",
        title: "诊断",
        summary: "native scrollback gated",
        fullText: "native scrollback gated",
        messageKind: "diagnostic",
      },
    ];
    for (const block of blocks) {
      upsertTranscriptSourceCell(source, {
        id: block.id,
        kind:
          block.messageKind === "user_text"
            ? "user"
            : block.messageKind === "diagnostic"
              ? "diagnostic"
              : "assistant",
        block,
      });
    }

    const fromBlocks = createShellViewModel(ctx, { outputBlocks: blocks, viewMode: "task" });
    const fromSource = createShellViewModel(ctx, { transcriptSource: source, viewMode: "task" });
    const inferredFromSource = createShellViewModel(ctx, { transcriptSource: source });

    // Plan A: in native scrollback mode the source feeds the canonical
    // staticHistory projection (non-native replay path / Ctrl+O), not the live
    // Ink frame. Its projection must still match the block-derived projection
    // 1:1 without changing styles or order.
    expect(fromSource.staticHistoryBlocks).toEqual(fromBlocks.blocks);
    expect(fromSource.viewMode).toBe("task");
    expect(inferredFromSource.viewMode).toBe("task");
  });

  it("empty TranscriptSource falls back to current output blocks", () => {
    const ctx = makeFakeContext();
    const source = createTranscriptSource();
    const block: ProductBlockViewModel = {
      id: "fallback-block",
      kind: "details",
      status: "info",
      title: "",
      summary: "fallback visible",
      fullText: "fallback visible",
      messageKind: "assistant_text",
    };

    const view = createShellViewModel(ctx, {
      outputBlocks: [block],
      transcriptSource: source,
      viewMode: "task",
    });

    expect(view.blocks.find((candidate) => candidate.id === block.id)).toBeDefined();
  });

  it("source-backed projection preserves terminal-owned cells for canonical replay", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const ctx = makeFakeContext();
    const source = createTranscriptSource();
    const block: ProductBlockViewModel = {
      id: "source-terminal-owned",
      kind: "details",
      status: "info",
      title: "",
      summary: "already in terminal",
      fullText: "already in terminal",
      messageKind: "assistant_text",
      terminalOwned: true,
    };
    upsertTranscriptSourceCell(source, {
      id: block.id,
      kind: "assistant",
      block,
    });

    const view = createShellViewModel(ctx, { transcriptSource: source, viewMode: "task" });

    // Plan A: a committed (terminal-owned) source cell is preserved in the
    // canonical staticHistory projection for replay / Ctrl+O, but is NOT
    // rendered into the live native Ink frame.
    expect(view.staticHistoryBlocks?.find((candidate) => candidate.id === block.id)).toBeDefined();
    expect(view.blocks.find((candidate) => candidate.id === block.id)).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it("source-backed Static history keeps the append-only transcript beyond visible block clipping", () => {
    const ctx = makeFakeContext();
    const source = createTranscriptSource();
    for (let index = 0; index < 25; index++) {
      const block: ProductBlockViewModel = {
        id: `assistant-${index}`,
        kind: "details",
        status: "info",
        title: "",
        summary: `answer ${index}`,
        fullText: `answer ${index}`,
        messageKind: "assistant_text",
      };
      upsertTranscriptSourceCell(source, {
        id: block.id,
        kind: "assistant",
        block,
      });
    }

    const view = createShellViewModel(ctx, { transcriptSource: source, viewMode: "task" });

    expect(view.blocks.length).toBeLessThan(view.staticHistoryBlocks?.length ?? 0);
    expect(view.staticHistoryBlocks?.at(0)?.id).toBe("assistant-0");
    expect(view.staticHistoryBlocks?.at(-1)?.id).toBe("assistant-24");
  });

  it("passes Static history replay generation from context for normal-screen resize reflow", () => {
    const ctx = makeFakeContext() as ReturnType<typeof makeFakeContext> & {
      transcriptStaticReplayGeneration?: number;
    };
    ctx.transcriptStaticReplayGeneration = 3;
    const block: ProductBlockViewModel = {
      id: "replay-generation",
      kind: "details",
      status: "info",
      title: "",
      summary: "resize replay",
      fullText: "resize replay",
      messageKind: "assistant_text",
    };

    const view = createShellViewModel(ctx, { outputBlocks: [block], viewMode: "task" });

    expect(view.staticHistoryReplayGeneration).toBe(3);
  });

  it("keeps two submitted terminal-owned turns available through source-backed history", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const source = createTranscriptSource();
    const blocks: ProductBlockViewModel[] = [
      {
        id: "submit-1-user",
        kind: "user",
        status: "info",
        title: "first user",
        summary: "first user",
        fullText: "first user",
        messageKind: "user_text",
        keep: true,
        terminalOwned: true,
      },
      {
        id: "submit-1-assistant",
        kind: "details",
        status: "info",
        title: "",
        summary: "first assistant",
        fullText: "first assistant",
        messageKind: "assistant_text",
        keep: true,
        terminalOwned: true,
      },
      {
        id: "submit-2-user",
        kind: "user",
        status: "info",
        title: "second user",
        summary: "second user",
        fullText: "second user",
        messageKind: "user_text",
        keep: true,
        terminalOwned: true,
      },
    ];

    for (const block of blocks) {
      upsertTranscriptSourceCell(source, {
        id: block.id,
        kind: block.messageKind === "assistant_text" ? "assistant" : "user",
        block,
      });
    }

    const view = createShellViewModel(createContext(), {
      transcriptSource: source,
      viewMode: "task",
    });

    expect(source.cells.map((cell) => cell.id)).toEqual([
      "submit-1-user",
      "submit-1-assistant",
      "submit-2-user",
    ]);
    expect(view.staticHistoryBlocks?.map((block) => block.id)).toEqual([
      "submit-1-user",
      "submit-1-assistant",
      "submit-2-user",
    ]);
  });

  it("keeps only the unflushed submitted turn in Ink while flushed history is terminal-owned", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "1");
    const source = createTranscriptSource();
    const blocks: ProductBlockViewModel[] = [
      {
        id: "turn-1-user",
        kind: "user",
        status: "info",
        title: "第一条用户消息",
        summary: "第一条用户消息",
        fullText: "第一条用户消息",
        messageKind: "user_text",
        keep: true,
        terminalOwned: true,
      },
      {
        id: "turn-1-assistant",
        kind: "details",
        status: "info",
        title: "",
        summary: "第一条回复",
        fullText: "第一条回复",
        messageKind: "assistant_text",
        keep: true,
        terminalOwned: true,
      },
      {
        id: "turn-2-user",
        kind: "user",
        status: "info",
        title: "第二条用户消息",
        summary: "第二条用户消息",
        fullText: "第二条用户消息",
        messageKind: "user_text",
        keep: true,
        terminalOwned: true,
      },
      {
        id: "turn-2-assistant",
        kind: "details",
        status: "info",
        title: "",
        summary: "第二条回复",
        fullText: "第二条回复",
        messageKind: "assistant_text",
        keep: true,
        terminalOwned: true,
      },
      {
        id: "turn-3-user",
        kind: "user",
        status: "info",
        title: "第三条用户消息",
        summary: "第三条用户消息",
        fullText: "第三条用户消息",
        messageKind: "user_text",
        keep: true,
      },
    ];

    for (const block of blocks) {
      upsertTranscriptSourceCell(source, {
        id: block.id,
        kind: block.messageKind === "assistant_text" ? "assistant" : "user",
        block,
      });
    }

    const view = createShellViewModel(createContext(), {
      transcriptSource: source,
      viewMode: "task",
    });

    // Plan A single ownership: this view has only a transcriptSource (every row
    // already committed to terminal history) and no live outputBlocks. In
    // native scrollback mode the Ink frame must render NOTHING from the source —
    // committed rows live in the terminal's own scrollback, not the fixed
    // bottom frame. The canonical order stays in staticHistoryBlocks for the
    // non-native replay path and Ctrl+O.
    expect(view.blocks.map((block) => block.id)).toEqual([]);
    expect(view.staticHistoryBlocks?.map((block) => block.id)).toEqual([
      "turn-1-user",
      "turn-1-assistant",
      "turn-2-user",
      "turn-2-assistant",
      "turn-3-user",
    ]);
  });

  // Plan B single ownership: the sink writes history to terminal scrollback
  // synchronously at commit time and fires onFlush on the same call. There is no
  // flush queue, no reflow/replay state machine, and no geometry-wait — commit
  // either writes + returns true, or fails + returns false leaving the block in
  // the Ink fallback. These contract tests replace the old queue/replay suite.
  const makeTtyCapture = () => {
    let written = "";
    const output = Object.assign(
      new Writable({
        write(chunk, _encoding, callback) {
          written += String(chunk);
          callback();
        },
      }),
      { isTTY: true },
    );
    return { output, read: () => written };
  };

  it("native scrollback opt-in enables the raw terminal-first sink", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    vi.stubEnv("LINGHUN_FULLSCREEN", "1");
    const output = Object.assign(new Writable({ write() {} }), { isTTY: true });

    expect(createTerminalFirstAssistantSink(output)).toBeDefined();
  });

  it("terminal-first compatibility opt-out disables the default sink", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT", "0");
    vi.stubEnv("LINGHUN_FULLSCREEN", "1");
    const output = Object.assign(new Writable({ write() {} }), { isTTY: true });

    expect(createTerminalFirstAssistantSink(output)).toBeUndefined();
  });

  it("native scrollback compatibility opt-out disables the default sink", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    vi.stubEnv("LINGHUN_FULLSCREEN", "1");
    const output = Object.assign(new Writable({ write() {} }), { isTTY: true });

    expect(createTerminalFirstAssistantSink(output)).toBeUndefined();
  });

  it("non-TTY output disables the sink", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    expect(createTerminalFirstAssistantSink(new Writable({ write() {} }))).toBeUndefined();
  });

  it("commitStableAssistantText writes staged text to terminal history and fires onFlush inline", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    expect(sink).toBeDefined();
    const onFlush = vi.fn();
    sink?.stageStableAssistantText("A\nB");

    expect(sink?.commitStableAssistantText(undefined, onFlush)).toBe(true);
    // Synchronous single ownership: the write lands during commit, not on a
    // later flush tick.
    expect(read()).toContain("\x1B[1;17r");
    expect(read()).toContain("\x1B[17;1H");
    expect(read()).toContain("\r\nA\x1B[K");
    expect(read()).toContain("\r\nB\x1B[K");
    expect(read()).toContain("\x1B[u");
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("commitStableAssistantText returns false and skips onFlush when the terminal write fails", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const output = Object.assign(
      new Writable({
        write() {
          throw new Error("terminal write failed");
        },
      }),
      { isTTY: true },
    );
    const sink = createTerminalFirstAssistantSink(output, {
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    const onFlush = vi.fn();
    sink?.stageStableAssistantText("A\n");

    expect(sink?.commitStableAssistantText(undefined, onFlush)).toBe(false);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("commitStableAssistantText returns false when geometry gives no room above the frame", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      // y=1 leaves no history region above the frame → inserter refuses.
      viewportGeometry: { ...terminalHistoryGeometry, y: 1 },
      rows: 30,
    });
    sink?.stageStableAssistantText("A\n");

    expect(sink?.commitStableAssistantText()).toBe(false);
    expect(read()).toBe("");
  });

  it("commitStableAssistantText no-ops as success when nothing is staged", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });

    expect(sink?.commitStableAssistantText()).toBe(true);
    expect(read()).toBe("");
  });

  it("rollbackStableAssistantText drops staged text so a later commit writes nothing", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    sink?.stageStableAssistantText("discarded");
    sink?.rollbackStableAssistantText();

    expect(sink?.commitStableAssistantText()).toBe(true);
    expect(read()).toBe("");
  });

  it("commitStableTranscriptBlock writes a user/tool/command source row and fires onFlush inline", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      noColor: true,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    const commandBlock: ProductBlockViewModel = {
      id: "cmd-onflush",
      kind: "command",
      status: "info",
      title: "/help",
      summary: "",
      keep: true,
    };
    const onFlush = vi.fn();

    expect(sink?.commitStableTranscriptBlock?.(commandBlock, onFlush)).toBe(true);
    expect(read()).toContain("\r\n❯ /help\x1B[K");
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("commitStableTranscriptBlock returns false for a block it cannot render", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    const onFlush = vi.fn();
    const emptyBlock: ProductBlockViewModel = {
      id: "empty",
      kind: "details",
      status: "info",
      title: "",
      summary: "",
    };

    expect(sink?.commitStableTranscriptBlock?.(emptyBlock, onFlush)).toBe(false);
    expect(read()).toBe("");
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("commitUserTranscriptBlock writes the user row prefix and fires onFlush inline", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      noColor: true,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    const userBlock: ProductBlockViewModel = {
      id: "user-onflush",
      kind: "user",
      status: "info",
      title: "你是谁",
      summary: "你是谁",
      fullText: "你是谁",
      messageKind: "user_text",
      keep: true,
    };
    const onFlush = vi.fn();

    expect(sink?.commitUserTranscriptBlock?.(userBlock, onFlush)).toBe(true);
    expect(read()).toContain("│ 你是谁");
    expect(read()).toContain("\r\n\x1B[K");
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("commitTerminalFirstUserBlock helper fires onFlush exactly once via the sink", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      noColor: true,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    const userBlock: ProductBlockViewModel = {
      id: "user-helper",
      kind: "user",
      status: "info",
      title: "hello",
      summary: "hello",
      fullText: "hello",
      messageKind: "user_text",
      keep: true,
    };
    const onFlush = vi.fn();

    expect(commitTerminalFirstUserBlock(sink, userBlock, onFlush)).toBe(true);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("native scrollback gate commits assistant text through ANSI markdown rows", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    sink?.stageStableAssistantText("# Heading\n\nsome **bold** text");

    expect(sink?.commitStableAssistantText()).toBe(true);
    // ANSI styling present (color mode) and rows are terminated with \r\n + \x1B[K.
    expect(read()).toContain("\x1B[");
    expect(read()).toContain("Heading");
    expect(read()).toContain("\x1B[K");
  });

  it("native scrollback ANSI renderer respects no-color mode", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      noColor: true,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    sink?.stageStableAssistantText("plain text row");

    expect(sink?.commitStableAssistantText()).toBe(true);
    expect(read()).toContain("plain text row");
    // No SGR color escapes in no-color mode (cursor/scroll-region control codes
    // still use \x1B, so assert specifically on color-setting sequences).
    expect(read()).not.toMatch(/\x1B\[3\dm/);
  });

  it("native scrollback sink preserves code-fence state across incremental assistant commits", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      noColor: true,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });

    sink?.stageStableAssistantText("```ts\n");
    expect(sink?.commitStableAssistantText()).toBe(true);
    sink?.stageStableAssistantText("return state.message ?? \"Something went wrong\";\n");
    expect(sink?.commitStableAssistantText()).toBe(true);

    expect(read()).toContain("  + ts");
    expect(read()).toContain(" 1 │ return state.message ?? \"Something went wrong\";");
  });

  it("native scrollback stable assistant blocks use terminal-first code styling", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      noColor: true,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    const block: ProductBlockViewModel = {
      id: "assistant-code",
      kind: "details",
      status: "info",
      title: "",
      summary: "code",
      fullText: "```ts\none\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n```",
      messageKind: "assistant_text",
    };

    expect(sink?.commitStableTranscriptBlock?.(block)).toBe(true);
    expect(read()).toContain("  + ts");
    expect(read()).toContain(" 1 │ one");
    expect(read()).toContain("10 │ ten");
    expect(read()).toContain("\r\n\x1B[K");
  });

  it("native scrollback terminal-first code keeps syntax color when color is enabled", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      noColor: false,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });

    sink?.stageStableAssistantText("```ts\nconst answer = 1;\n```");

    expect(sink?.commitStableAssistantText()).toBe(true);
    expect(read()).toContain("  + ts");
    expect(read()).toContain(" 1 │ ");
    expect(read()).toMatch(/\x1B\[(?!0m|2m)[0-9;]+m/);
  });

  it("native scrollback sink renders stable diagnostic and local command rows", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      noColor: true,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    const diagnostic: ProductBlockViewModel = {
      id: "diag-row",
      kind: "details",
      status: "info",
      title: "",
      summary: "MCP status",
      fullText: "MCP status",
      messageKind: "diagnostic",
    };
    const local: ProductBlockViewModel = {
      id: "local-row",
      kind: "tool",
      status: "info",
      title: "",
      summary: "bash done",
      fullText: "bash done",
      messageKind: "local_command_output",
    };

    expect(sink?.commitStableTranscriptBlock?.(diagnostic)).toBe(true);
    expect(sink?.commitStableTranscriptBlock?.(local)).toBe(true);
    expect(read()).toContain("MCP status");
    expect(read()).toContain("⎿");
    expect(read()).toContain("bash done");
  });

  it("native scrollback sink renders assistant and tool success source rows", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "1");
    const { output, read } = makeTtyCapture();
    const sink = createTerminalFirstAssistantSink(output, {
      columns: 80,
      noColor: true,
      viewportGeometry: terminalHistoryGeometry,
      rows: 30,
    });
    const assistant: ProductBlockViewModel = {
      id: "asst-row",
      kind: "details",
      status: "info",
      title: "",
      summary: "assistant body",
      fullText: "assistant body",
      messageKind: "assistant_text",
    };
    const toolSuccess: ProductBlockViewModel = {
      id: "tool-row",
      kind: "tool",
      status: "info",
      title: "",
      summary: "tool body",
      fullText: "tool body",
      messageKind: "tool_result_success",
    };

    expect(sink?.commitStableTranscriptBlock?.(assistant)).toBe(true);
    expect(sink?.commitStableTranscriptBlock?.(toolSuccess)).toBe(true);
    const history = read();
    expect(history).toContain("assistant body");
    expect(history).toContain("tool body");
    // tool_result_success rows carry the ⎿ continuation prefix.
    expect(history).toContain("⎿");
    expect(history).toContain("  ⎿  tool body\x1B[K\r\n\x1B[K");
  });

  it("commit tick drains queued stable lines smoothly and catches up when queue is old", () => {
    vi.useFakeTimers();
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);

    output.beginAssistantStream("assistant-stream-tick");
    output.appendAssistantDelta("A\nB\nC");
    expect(blocks.find((b) => b.id === "assistant-stream-tick")).toBeUndefined();

    vi.advanceTimersByTime(16);
    expect(blocks.find((b) => b.id === "assistant-stream-tick")?.fullText).toBe("A\nB\n");
    expect(ctx.streamingAssistant?.tailText).toBe("C");

    output.appendAssistantDelta("D\nE\nF\nG\nH\nI\nJ\nK\nL\ntail");
    vi.advanceTimersByTime(16);
    expect(blocks.find((b) => b.id === "assistant-stream-tick")?.fullText).toBe(
      "A\nB\nCD\nE\nF\nG\nH\nI\nJ\nK\nL\n",
    );
    expect(ctx.streamingAssistant?.tailText).toBe("tail");
  });

  it("view-model dedupes streaming preview when final assistant block already has same text", () => {
    const ctx = createContext({
      streamingAssistant: { id: "assistant-stream-dedupe", text: "完成\n" },
    } as Partial<TuiContext>);
    const finalBlock = createOutputBlock("完成\n", "zh-CN", "assistant-stream-dedupe");
    finalBlock.keep = true;

    const view = createShellViewModel(ctx, {
      outputBlocks: [finalBlock],
      viewMode: "task",
    });

    expect(view.blocks.find((b) => b.id === "assistant-stream-dedupe")).toBeDefined();
    expect(view.streamingAssistantText).toBeUndefined();
  });

  it("view-model renders active assistant stream as committed block plus live tail", () => {
    const ctx = createContext({
      streamingAssistant: {
        id: "assistant-stream-continuous",
        text: "1. 标题\n说明正文",
        tailText: "说明正文",
      },
    } as Partial<TuiContext>);
    const committed = createOutputBlock("1. 标题\n", "zh-CN", "assistant-stream-continuous");
    committed.keep = true;

    const view = createShellViewModel(ctx, {
      outputBlocks: [committed],
      viewMode: "task",
    });

    expect(view.blocks.find((b) => b.id === "assistant-stream-continuous")?.fullText).toBe(
      "1. 标题",
    );
    expect(view.streamingAssistantText).toBe("\n说明正文");
  });

  it("ShellApp renders streaming preview as a sibling after blocks and before activity", async () => {
    const source = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    const blocksIndex = source.indexOf("transcriptBlocks.map(");
    const previewIndex = source.indexOf("streamingAssistantText ? (", blocksIndex);
    const activityIndex = source.indexOf("activity ? (", previewIndex);
    expect(blocksIndex).toBeGreaterThan(0);
    expect(previewIndex).toBeGreaterThan(blocksIndex);
    expect(activityIndex).toBeGreaterThan(previewIndex);
    expect(source).toContain("<StreamingMarkdown");
    expect(source).toContain("const visibleTranscriptBlocks = normalScreenNativeScrollback");
    // Plan A single ownership: ShellApp no longer filters by terminalOwned;
    // committed blocks are physically removed from view.blocks at the source.
    expect(source).not.toContain("block.terminalOwned !== true");
  });

  it("ShellApp keeps config and command panels in the independent fullscreen panel route", async () => {
    const source = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    const taskLayoutStart = source.indexOf("function TaskLayout(");
    const resolvePanelStart = source.indexOf("function resolvePanel(");
    const taskLayoutBody = source.slice(taskLayoutStart, resolvePanelStart);
    const resolvePanelBody = source.slice(resolvePanelStart);

    expect(taskLayoutBody).not.toContain("view.configPanel ? (");
    expect(resolvePanelBody).toContain("if (view.configPanel)");
    expect(resolvePanelBody).toContain("<ConfigPanel");
    expect(resolvePanelBody).toContain("if (view.commandPanel)");
    expect(resolvePanelBody).toContain("<CommandPanel");
  });

  // D.13M-B：beginAssistantStream 不得制造用户可见的空 block。
  // 等待态由 ActivityIndicator（mapRequestActivityToView）单独显示。
  it("beginAssistantStream 不创建空 block；endAssistantStream 之前没有 delta 时主屏不显示'没有可见输出。'", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks);

    output.beginAssistantStream("assistant-stream-empty-1");
    // 没有任何 delta 直接 end —— 模拟 thinking-only / 空响应 / 早期 abort
    output.endAssistantStream();

    // 不应有 keep:true 的空 streaming 占位 block 进入主屏
    expect(blocks.find((b) => b.keep === true)).toBeUndefined();

    // 即便 blocks 数组里挂了一条空 streaming block（防御性场景），view-model
    // 也必须把它从主屏滤掉，不渲染 "没有可见输出。" 占位行。
    const stuckEmpty = createOutputBlock("", "zh-CN", "stuck-empty-stream");
    stuckEmpty.keep = true;
    stuckEmpty.fullText = "";
    const view = createShellViewModel(createContext(), { outputBlocks: [stuckEmpty] });
    expect(view.blocks.find((b) => b.id === "stuck-empty-stream")).toBeUndefined();
    expect(view.blocks.some((b) => b.summary === "没有可见输出。")).toBe(false);
  });

  it("assistant streaming fullText stays visible without Ctrl+O auto-fold", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks);

    output.beginAssistantStream("assistant-stream-ctrl-o");
    // 普通 assistant 多行正文直接展示，不再自动折成 Ctrl+O。
    output.appendAssistantDelta("第一行\n第二行\n第三行");
    output.replaceAssistantBlockContent("assistant-stream-ctrl-o", "第一行\n第二行\n第三行");
    output.endAssistantStream();

    const streaming = blocks.find((b) => b.id === "assistant-stream-ctrl-o");
    expect(streaming).toBeDefined();

    const view = createShellViewModel(createContext(), { outputBlocks: blocks });
    const visible = view.blocks.find((b) => b.id === "assistant-stream-ctrl-o");
    expect(visible).toBeDefined();
    expect(visible?.nextAction).toBeUndefined();
    expect(visible?.fullText).toContain("第三行");
  });

  it("Phase 7.17.1: 200+ line assistant output stays in transcript body, not Ctrl+O substitute", () => {
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);
    const longText = Array.from({ length: 220 }, (_, index) => `assistant line ${index + 1}`).join(
      "\n",
    );

    output.beginAssistantStream("assistant-long-transcript");
    output.appendAssistantDelta(longText);
    output.endAssistantStream();

    const view = createShellViewModel(ctx, {
      width: 100,
      height: 24,
      viewMode: "task",
      outputBlocks: blocks,
    });
    const block = view.blocks.find((item) => item.id === "assistant-long-transcript");
    expect(block?.messageKind).toBe("assistant_text");
    expect(block?.keep).toBe(true);
    expect(block?.fullText?.split("\n")).toHaveLength(220);
    expect(block?.fullText).toContain("assistant line 220");
    expect(block?.nextAction).toBeUndefined();
    expect(view.transcriptScroll).toMatchObject({ scrollOffset: 0, stickToBottom: true });
    expect(ctx.lastFullOutput).toContain("assistant line 220");
  });

  it("output memory compact 保留 keep/fail/blocked 与最近普通输出", async () => {
    const blocks: ProductBlockViewModel[] = [
      { id: "keep-old", kind: "details", status: "info", title: "", summary: "keep", keep: true },
      { id: "fail-old", kind: "error", status: "fail", title: "", summary: "fail" },
      { id: "blocked-old", kind: "error", status: "blocked", title: "", summary: "blocked" },
    ];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks);

    for (let index = 0; index < 90; index += 1) {
      output.write(`ephemeral-${index}\n`);
    }
    await output.compactOutputMemory();

    expect(blocks.find((block) => block.id === "keep-old")).toBeDefined();
    expect(blocks.find((block) => block.id === "fail-old")).toBeDefined();
    expect(blocks.find((block) => block.id === "blocked-old")).toBeDefined();
    expect(blocks.length).toBeLessThanOrEqual(80);
    expect(blocks.some((block) => block.summary.includes("ephemeral-0"))).toBe(false);
    expect(blocks.some((block) => block.summary.includes("ephemeral-89"))).toBe(true);
  });

  it("output memory compact archives large lastFullOutput behind a bounded summary", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "linghun-output-memory-"));
    try {
      const ctx = { ...makeFakeContext(), projectPath: tempDir, sessionId: "s1" };
      const blocks: ProductBlockViewModel[] = [];
      const output = __testCreateShellBlockOutput(ctx, blocks);

      output.write(`${"large-output\n".repeat(1300)}`);
      await output.compactOutputMemory();

      expect(ctx.lastFullOutput).toContain("<persisted-tui-output>");
      expect(ctx.lastFullOutput?.length).toBeLessThan(12_000);
      expect(ctx.lastFullOutput).toContain("artifactPath: .linghun/session/tui-output/s1/");
      expect(ctx.lastFullOutput).toContain("preview:");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("output memory compact archives large block fullText behind a bounded summary", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "linghun-output-block-memory-"));
    try {
      const ctx = { ...makeFakeContext(), projectPath: tempDir, sessionId: "s1" };
      const large = "block-output\n".repeat(1300);
      const blocks: ProductBlockViewModel[] = [
        {
          id: "large-block",
          kind: "details",
          status: "info",
          title: "",
          summary: "large",
          fullText: large,
          keep: true,
        },
      ];
      const output = __testCreateShellBlockOutput(ctx, blocks);

      await output.compactOutputMemory();

      expect(blocks[0]?.fullText).toContain("<persisted-tui-block-output>");
      expect(blocks[0]?.fullText?.length).toBeLessThan(12_000);
      expect(blocks[0]?.fullText).toContain("artifactPath: .linghun/session/tui-output/s1/");
      expect(blocks[0]?.fullText).not.toContain(large);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("output memory compact serializes concurrent cleanup requests", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "linghun-output-concurrent-memory-"));
    try {
      const ctx = { ...makeFakeContext(), projectPath: tempDir, sessionId: "s1" };
      const blocks: ProductBlockViewModel[] = [];
      const output = __testCreateShellBlockOutput(ctx, blocks);

      output.write(`${"first-large-output\n".repeat(1300)}`);
      const firstCleanup = output.compactOutputMemory();
      output.write(`${"second-large-output\n".repeat(1300)}`);
      const secondCleanup = output.compactOutputMemory();

      await Promise.all([firstCleanup, secondCleanup]);

      expect(ctx.lastFullOutput).toContain("<persisted-tui-output>");
      expect(ctx.lastFullOutput).not.toContain("second-large-output\n".repeat(1300));
      expect(ctx.lastFullOutput?.length).toBeLessThan(12_000);
      expect(blocks.every((block) => (block.fullText?.length ?? 0) < 12_000)).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("StreamingMarkdown stable prefix", () => {
  it("only reparses the growing suffix after stable block boundaries", () => {
    const state = { stablePrefix: "" };

    const first = splitStreamingMarkdownForRender("第一段\n\n- 粗体 **还", state);
    expect(first.stablePrefix).toBe("第一段\n\n");
    expect(first.unstableSuffix).toBe("- 粗体 **还");
    expect(first.parsedSuffixInput).toBe("第一段\n\n- 粗体 **还");

    const second = splitStreamingMarkdownForRender("第一段\n\n- 粗体 **还在增长**\n`code`", state);
    expect(second.stablePrefix).toBe("第一段\n\n");
    expect(second.parsedSuffixInput).toBe("- 粗体 **还在增长**\n`code`");
    expect(second.parsedSuffixInput).not.toContain("第一段");

    const third = splitStreamingMarkdownForRender("第一段\n\n- 粗体 **还在增长**\n`code`\n", state);
    expect(third.stablePrefix).toBe("第一段\n\n- 粗体 **还在增长**\n`code`\n");
    expect(third.unstableSuffix).toBe("");
  });

  it("does not freeze newline-ended suffix while inline markdown is still open", () => {
    const state = { stablePrefix: "" };

    const first = splitStreamingMarkdownForRender("第一段\n\n**粗体还没闭合\n", state);
    expect(first.stablePrefix).toBe("第一段\n\n");
    expect(first.unstableSuffix).toBe("**粗体还没闭合\n");

    const second = splitStreamingMarkdownForRender("第一段\n\n**粗体已经闭合**\n", state);
    expect(second.stablePrefix).toBe("第一段\n\n**粗体已经闭合**\n");
    expect(second.unstableSuffix).toBe("");

    const codeState = { stablePrefix: "" };
    const openCode = splitStreamingMarkdownForRender("段落\n\n`code 还没闭合\n", codeState);
    expect(openCode.stablePrefix).toBe("段落\n\n");
    expect(openCode.unstableSuffix).toBe("`code 还没闭合\n");
  });

  it("holds markdown tables as a mutable suffix until a blank line closes the table", () => {
    const state = { stablePrefix: "" };
    const tableOpen = splitStreamingMarkdownForRender(
      [
        "这是表格：",
        "",
        "| 语言 | tree-sitter 绑定 |",
        "| --- | --- |",
        "| Rust | ✅ |",
        "",
      ].slice(0, 5).join("\n") + "\n",
      state,
    );

    expect(tableOpen.stablePrefix).toBe("这是表格：\n\n");
    expect(tableOpen.unstableSuffix).toContain("| 语言 | tree-sitter 绑定 |");

    const tableClosed = splitStreamingMarkdownForRender(
      [
        "这是表格：",
        "",
        "| 语言 | tree-sitter 绑定 |",
        "| --- | --- |",
        "| Rust | ✅ |",
        "",
        "表格后正文",
      ].join("\n"),
      state,
    );

    expect(tableClosed.stablePrefix).toContain("| Rust | ✅ |");
    expect(tableClosed.unstableSuffix).toBe("表格后正文");
  });
});

describe("D.13Q-UX — assistant_text 不卡片化 / Markdown 多行 / footer setup-needed", () => {
  function createContext(overrides: Partial<TuiContext> = {}): TuiContext {
    const language = overrides.language ?? "zh-CN";
    return {
      projectPath: "/tmp/proj",
      language,
      model: "deepseek-v4-flash-model-name",
      permissionMode: "default",
      sessionId: "session-test",
      cache: { history: [], config: { warnBelowHitRate: 0.75 } as never },
      index: { status: "ready" },
      backgroundTasks: [],
      permissions: { rules: [], recentDenied: [] },
      pendingNaturalCommand: null,
      pendingAutopilot: null,
      pendingLocalApproval: null,
      pendingModelSetup: null,
      config: {
        workspaceTrust: { recorded: true, level: "trusted" },
        defaultModel: "deepseek-v4-flash-model-name",
        modelRoutes: { routes: [] },
        providers: { deepseek: { model: "deepseek-chat" } },
      } as never,
      ...overrides,
    } as unknown as TuiContext;
  }

  it("assistant_text block 标记 messageKind=assistant_text 且保留多行 fullText", () => {
    const block = createOutputBlock("第一行内容\n第二行段落\n第三行收尾", "zh-CN", "out-multi");
    expect(block.messageKind).toBe("assistant_text");
    expect(block.fullText).toContain("第一行内容");
    expect(block.fullText).toContain("第二行段落");
    expect(block.fullText).toContain("第三行收尾");
  });

  it("D.13Q-UX Real Smoke Fix v3：含 error/failed 的普通正文不再误标 tool_result_error", () => {
    // 旧 D.13Q v2 行为：createOutputBlock 用 /error|failed/ 关键词扫描整段正文，
    // /mcp status 这类 diagnostic 文案也会被标红。v3 已经移除关键词扫描，
    // 普通正文一律走 messageKind=assistant_text、status=info；真正的工具错误
    // 由调用方显式构造 tool_result_error block。
    const block = createOutputBlock("error: something broke\nstack line A", "en-US", "out-err");
    expect(block.messageKind).toBe("assistant_text");
    expect(block.status).toBe("info");
    expect(block.kind).toBe("details");
  });

  it("assistant_text block 在 plain renderer 中保留多行（不打平到首行）", () => {
    const block = createOutputBlock("段落一\n段落二\n段落三", "zh-CN", "out-multiline");
    const ctx = createContext() as TuiContext & {
      ctrlOExpandState?: { active: boolean; blockId?: string };
    };
    ctx.ctrlOExpandState = { active: true, blockId: "out-multiline" };
    const view = createShellViewModel(ctx, {
      outputBlocks: [block],
      width: 120,
      viewMode: "task",
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("段落一");
    expect(rendered).toContain("段落二");
    expect(rendered).toContain("段落三");
  });

  it("code fence 在 plain renderer 中保留缩进和代码块层级", () => {
    const block = createOutputBlock(
      "说明\n```ts\nfunction x() {\n  return 1;\n}\n```",
      "zh-CN",
      "out-code",
    );
    const ctx = createContext() as TuiContext & {
      ctrlOExpandState?: { active: boolean; blockId?: string };
    };
    ctx.ctrlOExpandState = { active: true, blockId: "out-code" };
    const view = createShellViewModel(ctx, {
      noColor: true,
      outputBlocks: [block],
      width: 120,
      viewMode: "task",
    });
    const rendered = renderPlainShell(view);

    expect(rendered).toContain("  + ts");
    expect(rendered).toContain("  | function x() {");
    expect(rendered).toContain("  |   return 1;");
    expect(rendered).not.toContain("function x() { return 1; }");
  });

  it("diff code fence 在 color 与 no-color plain renderer 中展示结构化行号 gutter", () => {
    const diff = [
      "```diff",
      "--- a/demo.ts",
      "+++ b/demo.ts",
      "@@ -7,2 +7,2 @@",
      " context line",
      "-removed line",
      "+added line with enough trailing words to wrap in a narrow plain renderer",
      "```",
    ].join("\n");
    const colorCtx = createContext() as TuiContext & {
      ctrlOExpandState?: { active: boolean; blockId?: string };
    };
    colorCtx.ctrlOExpandState = { active: true, blockId: "out-diff-color" };
    const noColorCtx = createContext() as TuiContext & {
      ctrlOExpandState?: { active: boolean; blockId?: string };
    };
    noColorCtx.ctrlOExpandState = { active: true, blockId: "out-diff-nocolor" };
    const colorView = createShellViewModel(colorCtx, {
      outputBlocks: [createOutputBlock(diff, "zh-CN", "out-diff-color")],
      width: 120,
      height: 40,
      viewMode: "task",
    });
    const noColorView = createShellViewModel(noColorCtx, {
      noColor: true,
      outputBlocks: [createOutputBlock(diff, "zh-CN", "out-diff-nocolor")],
      width: 54,
      height: 40,
      viewMode: "task",
    });
    const colorRendered = renderPlainShell(colorView);
    const noColorRendered = renderPlainShell(noColorView);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching ESC control character
    const ANSI_STRIP = /\x1B\[[0-9;]*m/g;
    const stripAnsi = (value: string): string => value.replace(ANSI_STRIP, "");

    expect(colorRendered).toContain("\x1B[");
    expect(stripAnsi(colorRendered)).toContain("  |   8 + added line");
    expect(stripAnsi(colorRendered)).toContain("  | 8   - removed line");
    expect(colorRendered).toContain("@@ -7,2 +7,2 @@");
    expect(noColorRendered).toContain("  | --- a/demo.ts");
    expect(noColorRendered).toContain("  | @@ -7,2 +7,2 @@");
    expect(noColorRendered).toContain("  | 7 7   context line");
    expect(noColorRendered).toContain("  | 8   - removed line");
    expect(noColorRendered).toContain("  |   8 + added line with enough trailing words");
    expect(noColorRendered).toContain("  |       to wrap in a narrow plain renderer");
    expect(noColorRendered).not.toContain("\x1B[");

    const colorDiffLines = colorRendered
      .split("\n")
      .map(stripAnsi)
      .filter((line) => line.startsWith("  | "));
    const noColorDiffLines = noColorRendered
      .split("\n")
      .filter((line) => line.startsWith("  | "));
    expect(colorDiffLines.some((line) => line.includes("  8 + added line"))).toBe(true);
    for (const line of noColorDiffLines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(54);
    }
  });

  it("task 主屏中 user / assistant / tool / code 四类 block 在 no-color 下可区分", () => {
    const blocks: ProductBlockViewModel[] = [
      {
        id: "u1",
        kind: "command",
        status: "info",
        title: "请检查输出",
        summary: "请检查输出",
        messageKind: "user_text",
        keep: true,
      },
      createOutputBlock("普通助手回复\n```js\n  const ok = true;\n```", "zh-CN", "a1"),
      {
        id: "tool-1",
        kind: "tool",
        status: "pass",
        title: "",
        summary: "Bash completed",
        fullText: "Bash completed",
        messageKind: "tool_result_success",
      },
      {
        id: "local-1",
        kind: "tool",
        status: "pass",
        title: "",
        summary: "line one\nline two",
        fullText: "line one\nline two",
        messageKind: "local_command_output",
      },
    ];
    const ctx = createContext() as TuiContext & {
      ctrlOExpandState?: { active: boolean; blockId?: string };
    };
    ctx.ctrlOExpandState = { active: true, blockId: "a1" };
    const view = createShellViewModel(ctx, {
      noColor: true,
      outputBlocks: blocks,
      width: 120,
      viewMode: "task",
    });
    const rendered = renderPlainShell(view);

    expect(rendered).toContain("│ 请检查输出");
    expect(rendered).toContain("普通助手回复");
    expect(rendered).toContain("  |   const ok = true;");
    expect(rendered).toContain("Bash completed");
    expect(rendered).toContain("  ⎿  line one");
    expect(rendered).not.toContain("\x1B[");
  });

  it("ProductBlock keeps user_text and assistant_text visually layered", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ProductBlock.tsx"), "utf8");
    const userStart = source.indexOf('block.kind === "user"');
    const messageStart = source.indexOf("isMessageKind(block.messageKind)");
    const userBranch = source.slice(
      userStart,
      source.indexOf('if (block.kind === "command")', userStart),
    );
    const messageBranch = source.slice(
      messageStart,
      source.indexOf('if (block.messageKind === "assistant_thinking")', messageStart),
    );

    // user_text: plain text, no Markdown, dim separator + wrapText + background fill
    expect(userBranch).toContain("marginBottom={1}");
    expect(userBranch).toContain("│ ");
    expect(userBranch).toContain("const bodyWidth = Math.max(8, width - 2)");
    expect(userBranch).toContain("width={bodyWidth}");
    expect(userBranch).toContain("wrapText(body, bodyWidth)");
    expect(userBranch).toContain("wrapText");
    expect(userBranch).toContain("backgroundColor");
    expect(userBranch).not.toContain("MessageMarkdown");
    // assistant_text (via unified isMessageKind path): MessageMarkdown, compact margins
    expect(messageBranch).toContain("marginTop={0}");
    expect(messageBranch).toContain("marginBottom={1}");
    expect(messageBranch).toContain("MessageMarkdown");
  });

  it("Ink task layout keeps transcript, notices, composer, footer, and light hints separated", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const ctx = createContext();
    (ctx as unknown as { notifications?: unknown[] }).notifications = [
      {
        key: "lighthint:cache-hit-low",
        text: "最近缓存复用变低，后续响应可能会慢一点。",
        priority: "low",
        timeoutMs: 5000,
        createdAt: Date.now(),
        tone: "dim",
      },
    ];
    const blocks: ProductBlockViewModel[] = [
      {
        id: "u-layer",
        kind: "command",
        status: "info",
        title: "请检查输出",
        summary: "请检查输出",
        fullText: "请检查输出",
        messageKind: "user_text",
        keep: true,
      },
      createOutputBlock("助手回复第一段\n\n助手回复第二段", "zh-CN", "a-layer"),
    ];
    const controller = {
      getViewModel: () =>
        createShellViewModel(ctx, {
          width: output.columns,
          height: output.rows,
          noColor: true,
          viewMode: "task",
          outputBlocks: blocks,
          backgroundSummaries: [
            {
              id: "agent-blocked-history",
              kind: "agent",
              title: "Agent cli-tui-worker",
              status: "failed",
            },
            {
              id: "job-blocked-visible",
              kind: "job",
              title: "Job active worker",
              status: "blocked",
              currentStep: "needs handoff repair",
            },
          ],
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

    const text = output.text;
    const userIdx = text.indexOf("│ 请检查输出");
    const assistantIdx = text.indexOf("助手回复第一段");
    const workspaceIdx = text.indexOf("工作树：");
    const runtimeIdx = text.indexOf("详情 /background");
    const hintIdx = text.indexOf("最近缓存复用变低");
    // Composer has no border; locate it by the › prompt marker after hints
    const composerIdx = text.indexOf("›", hintIdx);
    const footerIdx = text.indexOf("Shift+Tab");

    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThan(userIdx);
    expect(hintIdx).toBeGreaterThan(0);
    expect(composerIdx).toBeGreaterThan(hintIdx);
    expect(footerIdx).toBeGreaterThan(composerIdx);
    // Phase 6.6: workspaceStatus / runtimeStatus are no longer rendered
    // by default in the footer. They move to /details / /status / doctor paths.
    expect(workspaceIdx).toBe(-1);
    expect(runtimeIdx).toBe(-1);
    expect(text).not.toContain("失败/阻塞 1");
    expect(text).not.toContain("Agent cli-tui-worker · blocked");
    expect(text).not.toContain("上次会话恢复的后台任务");
  });

  it("local_command_output/Bash 从属输出使用 ⎿，普通成功结果不出现 bordered CommandPanel", () => {
    const block: ProductBlockViewModel = {
      id: "local-bash",
      kind: "tool",
      status: "pass",
      title: "",
      summary: "ok",
      fullText: "ok",
      messageKind: "local_command_output",
    };
    const view = createShellViewModel(createContext(), {
      outputBlocks: [block],
      width: 120,
      viewMode: "task",
    });
    const rendered = renderPlainShell(view);

    expect(rendered).toContain("⎿");
    expect(view.commandPanel).toBeUndefined();
    expect(rendered).not.toContain("┌");
    expect(rendered).not.toContain("╭");
  });

  it("setupNeeded=true 时 footer model 显示 dim '--' 占位（不再回退到 deepseek-chat）", () => {
    const view = createShellViewModel(createContext(), {
      width: 120,
      viewMode: "task",
      setupNeeded: true,
    });
    expect(view.taskFooter?.model).toMatch(/模型\s*--|model\s*--/);
    expect(view.taskFooter?.modelDim).toBe(true);
  });

  it("cache 命中率 < 50% 时 footer cacheTone='warning'", () => {
    const ctx = createContext();
    (ctx as unknown as { cache: { history: { hitRate: number }[] } }).cache.history.push({
      hitRate: 0.4,
    });
    const view = createShellViewModel(ctx, {
      width: 120,
      viewMode: "task",
    });
    expect(view.taskFooter?.cacheTone).toBe("warning");
  });

  it("task footer cache uses recent 20-turn aggregate", () => {
    const ctx = createContext();
    const history = Array.from({ length: 19 }, (_, index) => ({
      turn: index + 1,
      timestamp: Date.now(),
      hitRate: 0.8,
      inputTokens: 20,
      outputTokens: 0,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      cacheWriteTokensSource: "reported",
      model: "test-model",
      provider: "test-provider",
      endpoint: "chat",
      source: "api_usage",
      compacted: false,
      freshness: { changedKeys: [] },
    }));
    history.push({
      ...history[0],
      turn: 20,
      hitRate: 0,
      inputTokens: 100,
      cacheReadTokens: 0,
    });
    (ctx as unknown as { cache: { history: typeof history } }).cache.history = history;

    const view = createShellViewModel(ctx, {
      width: 120,
      viewMode: "task",
    });

    expect(view.taskFooter?.cache).toBe("缓存 76%");
    expect(view.taskFooter?.cacheTone).toBe("default");
  });

  it("task footer cache uses English recent average label", () => {
    const ctx = createContext({ language: "en-US" });
    (ctx as unknown as { cache: { history: { hitRate: number; inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }[] } }).cache.history = [
      { hitRate: 0.8, inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0 },
      { hitRate: 0.25, inputTokens: 75, cacheReadTokens: 25, cacheWriteTokens: 0 },
    ];

    const view = createShellViewModel(ctx, {
      width: 120,
      viewMode: "task",
    });

    expect(view.taskFooter?.cache).toBe("Cache 53%");
    expect(view.taskFooter?.cacheTone).toBe("default");
  });

  it("recent cache aggregate only uses the latest 20 records", () => {
    const history = [
      { hitRate: 1, inputTokens: 0, cacheReadTokens: 1000, cacheWriteTokens: 0 },
      ...Array.from({ length: 20 }, () => ({
        hitRate: 0,
        inputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })),
    ];

    expect(computeRecentCacheHitRate(history)).toBe(0);
  });

  it("权限请求附带 explanationLines（不暴露 rule.id）", () => {
    const ctx = createContext();
    (
      ctx as unknown as {
        pendingLocalApproval: { kind: string; toolName: string; toolCall: { input: unknown } };
      }
    ).pendingLocalApproval = {
      kind: "model_tool_use",
      toolName: "Bash",
      toolCall: { input: { command: "git status" } },
    };
    const permission = mapPendingApprovalToPermission(ctx);
    expect(permission?.explanationLines).toBeDefined();
    expect(permission?.explanationLines?.length ?? 0).toBeGreaterThan(0);
    const joined = (permission?.explanationLines ?? []).join("\n");
    // 不应出现 UUID / rule.id 风格字符串
    expect(joined).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu);
    // 应包含"如何永久允许"指引
    expect(joined).toContain("/permissions");
  });

  it("D.13Q-UX Closure: notifications 按 createdAt+timeoutMs 过期后从 view 移除并收敛 context 队列", () => {
    const ctx = createContext();
    const now = Date.now();
    (ctx as unknown as { notifications?: unknown[] }).notifications = [
      {
        key: "expired-1",
        text: "已过期提示",
        priority: "low",
        timeoutMs: 1000,
        createdAt: now - 2000, // 2 秒前 + 1s 超时 → 过期
        tone: "dim",
      },
      {
        key: "live-1",
        text: "仍然活跃",
        priority: "medium",
        timeoutMs: 5000,
        createdAt: now - 100, // 0.1 秒前 + 5s 超时 → 活跃
        tone: "warning",
      },
      {
        key: "permanent-1",
        text: "无超时常驻",
        priority: "low",
        // 无 timeoutMs → 常驻
        tone: "dim",
      },
    ];
    const view = createShellViewModel(ctx, { width: 120, viewMode: "task" });
    const live = view.notifications ?? [];
    const liveKeys = live.map((n) => n.key).sort();
    expect(liveKeys).toEqual(["live-1", "permanent-1"]);
    // 过期项也从 context 队列里被收敛掉，避免无限积累。
    const ctxQueue = (ctx as unknown as { notifications?: { key: string }[] }).notifications ?? [];
    const ctxKeys = ctxQueue.map((n) => n.key).sort();
    expect(ctxKeys).toEqual(["live-1", "permanent-1"]);
  });

  it("D.13Q-UX Closure: notifications 不进 transcript 也不替换 lastFullOutput", () => {
    const ctx = createContext();
    (ctx as unknown as { lastFullOutput?: string }).lastFullOutput = "已有正文：关键证据 X";
    (ctx as unknown as { notifications?: unknown[] }).notifications = [
      {
        key: "live-2",
        text: "右对齐轻提示",
        priority: "medium",
        timeoutMs: 5000,
        createdAt: Date.now(),
        tone: "warning",
      },
    ];
    const view = createShellViewModel(ctx, { width: 120, viewMode: "task" });
    // notifications 单独走 view.notifications；不进 view.blocks transcript。
    const transcriptText = view.blocks.map((b) => b.fullText ?? b.summary ?? "").join("\n");
    expect(transcriptText).not.toContain("右对齐轻提示");
    // lastFullOutput 不被替换。
    expect((ctx as unknown as { lastFullOutput?: string }).lastFullOutput).toBe(
      "已有正文：关键证据 X",
    );
    expect(view.notifications?.[0]?.text).toBe("右对齐轻提示");
  });

  it("cache-hit-low light hint is dim/low rather than an error or fail warning", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "cache-command-runtime.ts"), "utf8");
    const streamSource = await readFile(join(SRC_ROOT, "model-stream-runtime.ts"), "utf8");
    const hintStart = source.indexOf('"cache-hit-low"');
    const hintSnippet = source.slice(hintStart, hintStart + 260);
    const policyHintsStart = streamSource.indexOf("function enqueuePolicyHints");
    const notificationStart = streamSource.indexOf("context.notifications.push", policyHintsStart);
    const notificationSnippet = streamSource.slice(notificationStart, notificationStart + 360);

    expect(hintSnippet).toContain('"info"');
    expect(hintSnippet).toContain("10,");
    expect(notificationSnippet).toContain(
      'priority: hint.severity === "warning" ? "medium" : "low"',
    );
    expect(notificationSnippet).toContain('tone: hint.severity === "warning" ? "warning" : "dim"');
    expect(hintSnippet).not.toContain('"error"');
    expect(hintSnippet).not.toContain('"fail"');
  });
});

describe("D.13Q-UX Real Smoke Fix v2 — A. submitted thinking activity fallback", () => {
  it("submitted=true 且 options.activity 缺省时合成 thinking fallback (zh-CN)", () => {
    const view = createShellViewModel(createContext({ language: "zh-CN" }), {
      width: 80,
      submitted: true,
    });
    expect(view.viewMode).toBe("pending");
    expect(view.activity).toBeDefined();
    expect(view.activity?.phase).toBe("thinking");
    expect(view.activity?.text).toBe("提交请求…");
  });

  it("submitted=true en-US 合成 Thinking… fallback", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      submitted: true,
    });
    expect(view.activity?.phase).toBe("thinking");
    expect(view.activity?.text).toBe("Submitting request…");
  });

  it("真实 activity（mapRequestActivityToView 输出）覆盖 submitted fallback", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      submitted: true,
      activity: { phase: "tool_running", text: "正在运行 Bash…", toolName: "Bash" },
    });
    expect(view.activity?.phase).toBe("tool_running");
    expect(view.activity?.text).toBe("正在运行 Bash…");
  });
});

describe("deriveBackgroundActivityFallback — request activity cleared but work still active", () => {
  const fakeLastModelRequest = { phase: "idle", endedAt: "2026-01-01T00:00:00.000Z" };

  it("running agent with lastModelRequest → activity shows agent waiting", () => {
    const ctx = createContext({
      agents: [
        {
          id: "a1",
          displayName: "reviewer",
          status: "running",
          mailbox: [],
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      backgroundTasks: [],
      lastModelRequest: fakeLastModelRequest,
    } as unknown as Partial<TuiContext>);
    const view = createShellViewModel(ctx, { width: 80 });
    expect(view.activity).toBeDefined();
    expect(view.activity!.text).toContain("reviewer");
    expect(view.activity!.phase).toBe("continuing");
    expect(view.activity!.elapsed).toBeDefined();
  });

  it("multiple running agents → activity shows count", () => {
    const ctx = createContext({
      agents: [
        { id: "a1", status: "running", mailbox: [], startedAt: "2026-01-01T00:00:00.000Z" },
        { id: "a2", status: "running", mailbox: [], startedAt: "2026-01-01T00:00:00.000Z" },
      ],
      backgroundTasks: [],
      lastModelRequest: fakeLastModelRequest,
    } as unknown as Partial<TuiContext>);
    const view = createShellViewModel(ctx, { width: 80 });
    expect(view.activity).toBeDefined();
    expect(view.activity!.text).toContain("2");
  });

  it("running workflow → activity shows workflow running", () => {
    const ctx = createContext({
      agents: [],
      backgroundTasks: [],
      workflows: { activeRuns: [{ id: "w1", status: "running", steps: [] }] },
      lastModelRequest: fakeLastModelRequest,
    } as unknown as Partial<TuiContext>);
    const view = createShellViewModel(ctx, { width: 80 });
    expect(view.activity).toBeDefined();
    expect(view.activity!.text).toContain("工作流");
  });

  it("running background tasks → activity shows bg task count", () => {
    const ctx = createContext({
      agents: [],
      backgroundTasks: [
        { status: "running", startedAt: "2026-01-01T00:00:00.000Z" },
        { status: "running", startedAt: "2026-01-01T00:00:05.000Z" },
      ],
      lastModelRequest: fakeLastModelRequest,
    } as unknown as Partial<TuiContext>);
    const view = createShellViewModel(ctx, { width: 80 });
    expect(view.activity).toBeDefined();
    expect(view.activity!.text).toContain("2");
    expect(view.activity!.text).toContain("后台任务");
    expect(view.activity!.elapsed).toBeDefined();
  });

  it("no active items + no lastModelRequest → activity undefined, busy=false", () => {
    const ctx = createContext({
      agents: [],
      backgroundTasks: [],
      lastModelRequest: undefined,
    } as unknown as Partial<TuiContext>);
    const view = createShellViewModel(ctx, { width: 80 });
    expect(view.activity).toBeUndefined();
    expect(view.composer.busy).toBe(false);
  });

  it("all agents completed + lastModelRequest → no spurious activity", () => {
    const ctx = createContext({
      agents: [
        { id: "a1", status: "completed", mailbox: [], startedAt: "2026-01-01T00:00:00.000Z" },
      ],
      backgroundTasks: [{ status: "completed" }],
      lastModelRequest: fakeLastModelRequest,
    } as unknown as Partial<TuiContext>);
    const view = createShellViewModel(ctx, { width: 80 });
    expect(view.activity).toBeUndefined();
  });
});

describe("D.13Q-UX Real Smoke Fix v2 — B. Composer task width", () => {
  it("ShellApp uses the task composer layout width source", async () => {
    const fs = await import("node:fs");
    const shellSource = fs.readFileSync(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    const bottomPaneSource = fs.readFileSync(
      join(SRC_ROOT, "shell/components/TaskBottomPane.tsx"),
      "utf8",
    );
    const composerSource = fs.readFileSync(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");

    expect(shellSource).not.toContain("homeComposerLayout");
    expect(bottomPaneSource).toContain("layout={taskComposerLayout(view.width)}");
    expect(bottomPaneSource).toMatch(/function taskComposerLayout\(viewWidth: number\)[\s\S]*taskComposerMaxWidth\(viewWidth\)/);
    expect(composerSource).toContain("layout?: ComposerLayout");
  });
});

describe("D.13Q-UX Real Smoke Fix v2 — D. busy guard 不吞草稿", () => {
  it("submitted=true 时 view.composer.busy=true 且带 busyHint (zh-CN)", () => {
    const view = createShellViewModel(createContext({ language: "zh-CN" }), {
      width: 80,
      submitted: true,
    });
    expect(view.composer.busy).toBe(true);
    expect(view.composer.busyHint ?? "").toContain("正在处理");
  });

  it("activeAbortController 存在时 busy=true，即使 submitted=false", () => {
    const ctx = createContext();
    (ctx as { activeAbortController?: AbortController }).activeAbortController =
      new AbortController();
    const view = createShellViewModel(ctx, { width: 80 });
    expect(view.composer.busy).toBe(true);
  });

  it("空闲时 busy=false，busyHint=undefined", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    expect(view.composer.busy).toBe(false);
    expect(view.composer.busyHint).toBeUndefined();
  });

  it("Composer 源码在 busy 时 Enter 不提交不清空，仅 showHintNotice", async () => {
    const fs = await import("node:fs");
    const composerSource = fs.readFileSync(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    expect(composerSource).toMatch(/view\.composer\.busy && !isSlashSubmit/);
    expect(composerSource).toMatch(/showHintNotice\([\s\S]*?busyHint/);
  });
});

describe("D.13Q-UX Real Smoke Fix v2 — F. permission 主屏降噪", () => {
  it("permission view-model 仍持有 explanationLines，但主屏渲染层不展示", () => {
    const ctx = createContext();
    (ctx as unknown as { pendingLocalApproval?: unknown }).pendingLocalApproval = {
      kind: "model_tool_use",
      toolName: "Bash",
      toolCall: { input: { command: "git status" } },
    };
    const permission = mapPendingApprovalToPermission(ctx);
    expect(permission).toBeDefined();
    // explanationLines 仍存在（详情通过 /details 路径展开）
    expect((permission?.explanationLines ?? []).length).toBeGreaterThan(0);
  });

  it("Composer 源码 PermissionControl 不再 map explanationLines 到主屏", async () => {
    const fs = await import("node:fs");
    const composerSource = fs.readFileSync(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    // 主屏 PermissionControl 不再渲染 explanationLines.map（除了 SlashSuggestions 等不相关 map）
    // 锚定 Enter/Tab/d/Esc 提示出现在源码中
    expect(composerSource).toMatch(/Enter\s*确认\s*·\s*Tab\s*切换\s*·\s*d\s*详情\s*·\s*Esc\s*取消/);
    // 旧的"查看详情"提示已替换为更短的"详情"
    expect(composerSource).not.toMatch(/Esc\s*取消\s*·\s*d\s*查看详情/);
  });
});

describe("TaskSuggestionBar executable state", () => {
  it("filters handled suggestions and clamps cursor", () => {
    const ctx = createContext({
      handledTaskSuggestionIds: new Set(["tool_error:details:out-fail"]),
      taskSuggestionCursor: 9,
    } as Partial<TuiContext>);

    const view = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "out-fail",
          kind: "error",
          status: "fail",
          title: "Bash 失败",
          summary: "exit 1",
        },
      ],
      setupNeeded: true,
    });

    expect(view.taskSuggestions?.some((item) => item.id === "tool_error:details:out-fail")).toBe(
      false,
    );
    expect(view.taskSuggestions?.[0]?.id).toBe("setup:resume");
    expect(view.taskSuggestionCursor).toBe(0);
  });

  it("keeps provider request failure to a single visible prompt", () => {
    const ctx = createContext({
      lastProviderFailure: {
        code: "PROVIDER_STREAM_ERROR",
        kind: "transit",
        provider: "openai",
        model: "gpt-5",
        endpointProfile: "default",
        summary: "stream ended",
      },
    } as unknown as Partial<TuiContext>);

    const view = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "provider-fail",
          kind: "error",
          status: "fail",
          title: "模型请求失败",
          summary: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          fullText: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          messageKind: "tool_result_error",
        },
      ],
    });

    expect(view.blocks.some((block) => block.title === "模型请求失败")).toBe(true);
    expect(view.taskSuggestions?.some((item) => item.source === "tool_error") ?? false).toBe(
      false,
    );
    expect(view.bottomPaneStatus?.text).not.toBe("Provider 请求失败");
  });

  it("hides stale provider request failure after the provider has recovered", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "provider-fail",
          kind: "error",
          status: "fail",
          title: "模型请求失败",
          summary: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          fullText: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          messageKind: "tool_result_error",
        },
        {
          id: "assistant-ok",
          kind: "details",
          status: "partial",
          title: "assistant",
          summary: "后续请求已经正常完成。",
          fullText: "后续请求已经正常完成。",
          messageKind: "assistant_text",
        },
      ],
    });

    expect(view.blocks.some((block) => block.title === "模型请求失败")).toBe(false);
    expect(view.blocks.some((block) => block.summary?.includes("正常完成"))).toBe(true);
  });

  it("hides stale provider request failure after tool progress resumes", () => {
    const view = createShellViewModel(createContext({
      lastProviderFailure: {
        code: "PROVIDER_STREAM_ERROR",
        kind: "transit",
        provider: "openai",
        model: "gpt-5",
        endpointProfile: "default",
        summary: "stream ended",
      },
    } as unknown as Partial<TuiContext>), {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "provider-fail",
          kind: "error",
          status: "fail",
          title: "模型请求失败",
          summary: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          fullText: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          messageKind: "tool_result_error",
        },
        {
          id: "tool-progress",
          kind: "details",
          status: "info",
          title: "ReadSnippets",
          summary: "已读取 4 条结果。",
          fullText: "已读取 4 条结果。",
          messageKind: "tool_result_success",
        },
      ],
    });

    expect(view.blocks.some((block) => block.title === "模型请求失败")).toBe(false);
    expect(view.blocks.some((block) => block.title === "ReadSnippets")).toBe(true);
    expect(view.bottomPaneStatus?.text).not.toBe("Provider 请求失败");
  });

  it("hides stale provider request failure while a new provider request is active", () => {
    const view = createShellViewModel(createContext({
      requestActivityPhase: "request_started",
      lastProviderFailure: {
        code: "PROVIDER_STREAM_ERROR",
        kind: "transit",
        provider: "openai",
        model: "gpt-5",
        endpointProfile: "default",
        summary: "stream ended",
      },
    } as unknown as Partial<TuiContext>), {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "provider-fail",
          kind: "error",
          status: "fail",
          title: "模型请求失败",
          summary: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          fullText: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          messageKind: "tool_result_error",
        },
      ],
    });

    expect(view.blocks.some((block) => block.title === "模型请求失败")).toBe(false);
    expect(view.bottomPaneStatus?.text).not.toBe("Provider 请求失败");
  });

  it("hides stale provider request failure while provider retry activity is active", () => {
    const view = createShellViewModel(createContext({
      requestActivityPhase: "provider_retrying",
      retryInfo: { attempt: 1, max: 3, delaySec: 2 },
      lastProviderFailure: {
        code: "PROVIDER_STREAM_ERROR",
        kind: "transit",
        provider: "openai",
        model: "gpt-5",
        endpointProfile: "default",
        summary: "stream ended",
      },
    } as unknown as Partial<TuiContext>), {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "provider-fail",
          kind: "error",
          status: "fail",
          title: "模型请求失败",
          summary: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          fullText: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          messageKind: "tool_result_error",
        },
      ],
    });

    expect(view.blocks.some((block) => block.title === "模型请求失败")).toBe(false);
    expect(view.bottomPaneStatus?.text).not.toBe("Provider 请求失败");
  });

  it("hides compact boundary while work continues after compact", () => {
    const view = createShellViewModel(createContext({
      requestActivityPhase: "request_started",
    } as Partial<TuiContext>), {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "compact-1",
          kind: "details",
          status: "info",
          title: "对话已压缩 · 释放约 74K 字符 (10%)",
          summary: "",
          messageKind: "compact_boundary",
        },
      ],
    });

    expect(view.blocks.some((block) => block.messageKind === "compact_boundary")).toBe(false);
  });

  it("hides compact boundary during submitted fallback activity", () => {
    const view = createShellViewModel(createContext({ language: "zh-CN" }), {
      width: 80,
      viewMode: "pending",
      submitted: true,
      outputBlocks: [
        {
          id: "compact-1",
          kind: "details",
          status: "info",
          title: "对话已压缩 · 释放约 74K 字符 (10%)",
          summary: "",
          messageKind: "compact_boundary",
        },
      ],
    });

    expect(view.activity?.text).toBe("提交请求…");
    expect(view.blocks.some((block) => block.messageKind === "compact_boundary")).toBe(false);
  });

  it("hides compact boundary after later transcript progress", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "compact-1",
          kind: "details",
          status: "info",
          title: "对话已压缩 · 释放约 74K 字符 (10%)",
          summary: "",
          messageKind: "compact_boundary",
        },
        {
          id: "tool-progress",
          kind: "details",
          status: "info",
          title: "ReadSnippets",
          summary: "已读取 4 条结果。",
          fullText: "已读取 4 条结果。",
          messageKind: "tool_result_success",
        },
      ],
    });

    expect(view.blocks.some((block) => block.messageKind === "compact_boundary")).toBe(false);
    expect(view.blocks.some((block) => block.title === "ReadSnippets")).toBe(true);
  });

  it("renders provider retry outcome inside the same error block", () => {
    const view = createShellViewModel(createContext({
      lastProviderFailure: {
        code: "PROVIDER_STREAM_ERROR",
        kind: "transit",
        provider: "openai",
        model: "gpt-5",
        endpointProfile: "default",
        summary: "stream ended",
      },
    } as unknown as Partial<TuiContext>), {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "provider-fail",
          kind: "error",
          status: "fail",
          title: "模型请求失败",
          summary: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          fullText: "模型请求未完成。可运行 /model doctor 查看详情后重试。",
          messageKind: "tool_result_error",
          retryAttempt: 2,
          retryMax: 2,
        },
      ],
    });

    const rendered = renderPlainShell(view);

    expect(rendered).toContain("已自动重试 2/2 后仍未完成");
    expect(rendered).not.toContain("正在重试");
  });

  it("permission view includes details and project-level allow choices", () => {
    const ctx = createContext();
    (ctx as unknown as { pendingLocalApproval?: unknown }).pendingLocalApproval = {
      kind: "model_tool_use",
      toolName: "Bash",
      toolCall: { input: { command: "git status" } },
    };
    const permission = mapPendingApprovalToPermission(ctx);
    const view = createShellViewModel(ctx, {
      width: 80,
      viewMode: "pending",
      permission,
    });
    expect(view.permission?.actions?.map((item) => item.id)).toContain("details");
    expect(view.permission?.actions?.map((item) => item.id)).toContain("allow_always_tool");
  });
});

describe("D.13Q-UX Real Smoke Fix v2 — C. user transcript block factory", () => {
  it("createUserTextBlock 产出 messageKind=user_text 的 keep transcript 行", async () => {
    const presenterModule = await import("./models/command-transcript-presenter.js");
    const block = presenterModule.createUserTextBlock(7, "  请帮我看下当前阶段任务  ");
    expect(block.kind).toBe("user");
    expect(block.messageKind).toBe("user_text");
    expect(block.keep).toBe(true);
    expect(block.title).toBe("请帮我看下当前阶段任务");
    expect(block.id).toBe("usr:7");
  });

  it("createUserTextBlock 多行只保留 fullText，title 取首行避免撑爆主屏", async () => {
    const presenterModule = await import("./models/command-transcript-presenter.js");
    const block = presenterModule.createUserTextBlock(8, "第一行\n第二行\n第三行");
    expect(block.title).toBe("第一行");
    expect(block.fullText).toBe("第一行\n第二行\n第三行");
  });
});

describe("D.13Q-UX Real Smoke Fix v2 — E. permission-action 结构化事件", () => {
  it("Composer.submitPermissionAction 不再用 PERMISSION_TEXT_MAP 走 submit 文本", async () => {
    const fs = await import("node:fs");
    const composerSource = fs.readFileSync(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    // PERMISSION_TEXT_MAP 已删除
    expect(composerSource).not.toContain("PERMISSION_TEXT_MAP[id]");
    // submitPermissionAction 派 permission-action 事件
    expect(composerSource).toMatch(/type:\s*"permission-action"\s*,\s*actionId:\s*id/);
  });
});

// ─── D.13Q-UX Real Smoke Fix v3 ──────────────────────────────────────────────
// 1) transcript 严格按 append 时间顺序（fail / keep 不重排到旧消息上方）
// 2) /mcp / diagnostic 文案不再被关键词扫描误伤为 fail
// 3) Ctrl+O hint 只在真有可展开内容时出现
// 4) provider 括号文案不混入用户消息渲染层
describe("D.13Q-UX Real Smoke Fix v3 — transcript 顺序", () => {
  it("user → assistant → diagnostic → user → assistant 时间顺序保留", () => {
    const userBlocks: ProductBlockViewModel[] = [
      {
        id: "usr:1",
        kind: "command",
        status: "info",
        title: "你好",
        summary: "",
        keep: true,
        messageKind: "user_text",
      },
      {
        id: "ai:1",
        kind: "details",
        status: "info",
        title: "",
        summary: "你好，需要做什么？",
        fullText: "你好，需要做什么？",
        keep: true,
        messageKind: "assistant_text",
      },
      {
        id: "diag:1",
        kind: "details",
        status: "info",
        title: "",
        summary: "MCP status",
        fullText: "MCP status\n- enabled: yes",
        messageKind: "diagnostic",
      },
      {
        id: "usr:2",
        kind: "command",
        status: "info",
        title: "再帮我跑一下",
        summary: "",
        keep: true,
        messageKind: "user_text",
      },
      {
        id: "ai:2",
        kind: "details",
        status: "info",
        title: "",
        summary: "好的",
        fullText: "好的",
        keep: true,
        messageKind: "assistant_text",
      },
    ];
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: userBlocks,
    });
    const ids = view.blocks
      .map((b) => b.id)
      .filter((id) => id.startsWith("usr:") || id.startsWith("ai:") || id.startsWith("diag:"));
    expect(ids).toEqual(["usr:1", "ai:1", "diag:1", "usr:2", "ai:2"]);
  });

  it("失败块不会被推到旧消息上方（按出现顺序保留）", () => {
    const blocks: ProductBlockViewModel[] = [
      {
        id: "usr:1",
        kind: "command",
        status: "info",
        title: "old user",
        summary: "",
        keep: true,
        messageKind: "user_text",
      },
      {
        id: "ai:1",
        kind: "details",
        status: "info",
        title: "",
        summary: "old assistant",
        fullText: "old assistant",
        keep: true,
        messageKind: "assistant_text",
      },
      {
        id: "fail:1",
        kind: "error",
        status: "fail",
        title: "Bash failed",
        summary: "exit 1\nstderr details",
        fullText: "exit 1\nstderr details",
        messageKind: "tool_result_error",
      },
      {
        id: "usr:2",
        kind: "command",
        status: "info",
        title: "new user",
        summary: "",
        keep: true,
        messageKind: "user_text",
      },
    ];
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: blocks,
    });
    const ids = view.blocks
      .map((b) => b.id)
      .filter((id) => ["usr:1", "ai:1", "fail:1", "usr:2"].includes(id));
    // fail:1 必须出现在 usr:1/ai:1 之后、usr:2 之前
    expect(ids).toEqual(["usr:1", "ai:1", "fail:1", "usr:2"]);
  });

  it("ephemeral 限流只丢最早的 ephemeral，不影响 keep 与 fail 的位置", () => {
    // 需要超过 maxEphemeral=20 条 ephemeral 才能触发限流
    const blocks: ProductBlockViewModel[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `eph:${i + 1}`,
        kind: "details" as const,
        status: "info" as const,
        title: "",
        summary: `e${i + 1}`,
        fullText: `e${i + 1}`,
      })),
      {
        id: "usr:1",
        kind: "command" as const,
        status: "info" as const,
        title: "kept user",
        summary: "",
        keep: true,
        messageKind: "user_text" as const,
      },
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `eph:${i + 11}`,
        kind: "details" as const,
        status: "info" as const,
        title: "",
        summary: `e${i + 11}`,
        fullText: `e${i + 11}`,
      })),
    ];
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: blocks,
    });
    const ids = view.blocks
      .map((b) => b.id)
      .filter((id) => id.startsWith("eph:") || id.startsWith("usr:"));
    // 25 条 ephemeral 超过 cap=20，应丢最早的 5 条；keep 的 usr:1 必须保留且不被推到顶。
    expect(ids).toContain("usr:1");
    expect(ids).toContain("eph:25");
    expect(ids).toContain("eph:6");
    expect(ids).not.toContain("eph:1");
    expect(ids).not.toContain("eph:5");
    // 顺序：usr:1 在 eph:11 之前出现
    const usrPos = ids.indexOf("usr:1");
    const eph11Pos = ids.indexOf("eph:11");
    expect(usrPos).toBeLessThan(eph11Pos);
  });
});

describe("D.13Q-UX Real Smoke Fix v3 — diagnostic 不被关键词误伤", () => {
  it("正文含'失败'字样的 diagnostic 不再变 fail", () => {
    const block = createOutputBlock(
      "MCP status\n- 启动或检测失败会隔离\n- enabled: yes",
      "zh-CN",
      "out-mcp",
    );
    expect(block.status).toBe("info");
    expect(block.kind).toBe("details");
    expect(block.messageKind).toBe("assistant_text");
  });

  it("正文含'error / failed'字样的普通正文不再变 fail", () => {
    const enBlock = createOutputBlock(
      "Build summary\n- compile: error count = 0\n- tests: 0 failed",
      "en-US",
      "out-build",
    );
    expect(enBlock.status).toBe("info");
    expect(enBlock.kind).toBe("details");
  });

  it("ShellBlockOutput.writeDiagnosticLine 写入 messageKind=diagnostic 块", () => {
    const ctx = {
      language: "zh-CN",
      lastFullOutput: undefined,
      suppressLastFullOutputCapture: false,
    } as unknown as TuiContext;
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks) as unknown as {
      writeDiagnosticLine?: (text: string) => void;
    };
    expect(typeof output.writeDiagnosticLine).toBe("function");
    output.writeDiagnosticLine?.(
      "MCP status\n- enabled: yes\n- lastDoctor: 未检测，运行 /mcp doctor 检测",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("diagnostic");
    expect(blocks[0]?.status).toBe("info");
    expect(ctx.transcriptSource?.cells[0]?.kind).toBe("diagnostic");
    expect(ctx.transcriptSource?.cells[0]?.block.fullText).toContain("MCP status");
  });

  it("ShellBlockOutput.writeErrorLine 写入 messageKind=tool_result_error 块（kind=error/status=fail）", () => {
    const ctx = {
      language: "zh-CN",
      lastFullOutput: undefined,
      suppressLastFullOutputCapture: false,
    } as unknown as TuiContext;
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks) as unknown as {
      writeErrorLine?: (text: string, title?: string) => void;
    };
    expect(typeof output.writeErrorLine).toBe("function");
    output.writeErrorLine?.(
      "provider 拒绝了本次请求 schema。请运行 /model doctor 检查 endpointProfile / tools / tool_choice。",
      "provider 失败",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("tool_result_error");
    expect(blocks[0]?.kind).toBe("error");
    expect(blocks[0]?.status).toBe("fail");
    expect(blocks[0]?.title).toBe("provider 失败");
    // 单行短错误不挂 Ctrl+O hint
    expect(blocks[0]?.nextAction).toBeUndefined();
    // fullText 累计到 lastFullOutput，让 /details 仍能展开
    expect(ctx.lastFullOutput).toContain("provider 拒绝了本次请求 schema");
    expect(ctx.transcriptSource?.cells[0]?.kind).toBe("tool_result_error");
    expect(ctx.transcriptSource?.cells[0]?.block.title).toBe("provider 失败");
  });

  it("ShellBlockOutput.writeErrorLine 多行错误正文挂 Ctrl+O 错误展开 hint", () => {
    const ctx = {
      language: "zh-CN",
      lastFullOutput: undefined,
      suppressLastFullOutputCapture: false,
    } as unknown as TuiContext;
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks) as unknown as {
      writeErrorLine?: (text: string, title?: string) => void;
    };
    output.writeErrorLine?.(
      "Provider request failed\n- code: PROVIDER_NETWORK_ERROR\n- detail: ECONNRESET while streaming",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("tool_result_error");
    expect(blocks[0]?.nextAction).toContain("Ctrl+O");
  });

  it("普通正文走 _write 路径仍 messageKind=assistant_text/info（含 error/failed 字样不再误标）", () => {
    const ctx = {
      language: "zh-CN",
      lastFullOutput: undefined,
      suppressLastFullOutputCapture: false,
    } as unknown as TuiContext;
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);
    output.write("error: build failed but this is just narrative\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("assistant_text");
    expect(blocks[0]?.status).toBe("info");
    expect(blocks[0]?.kind).toBe("details");
    expect(ctx.transcriptSource?.cells[0]?.kind).toBe("assistant");
    expect(ctx.transcriptSource?.cells[0]?.block.fullText).toContain("error: build failed");
  });

  it("Bash/local command producer 写入 local_command_output，从属输出不走 CommandPanel", () => {
    const ctx = createContext({
      lastFullOutput: undefined,
      suppressLastFullOutputCapture: false,
    } as Partial<TuiContext>);
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks) as unknown as {
      writeLocalCommandOutputLine?: (text: string) => void;
    };
    output.writeLocalCommandOutputLine?.("Tool Bash completed\n- 40 行");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("local_command_output");
    expect(blocks[0]?.kind).toBe("tool");
    expect(ctx.lastFullOutput).toContain("Tool Bash completed");
    expect(ctx.transcriptSource?.cells[0]?.kind).toBe("local_command_output");
    expect(ctx.transcriptSource?.cells[0]?.block.fullText).toContain("Tool Bash completed");
    const view = createShellViewModel(ctx, {
      outputBlocks: blocks,
      width: 100,
      viewMode: "task",
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("⎿");
    expect(view.commandPanel).toBeUndefined();
    expect(rendered).not.toContain("┌");
    expect(rendered).not.toContain("╭");
  });
});

describe("D.13Q-UX Real Smoke Fix v3 — RuntimeIdentityRule provider 隐藏", () => {
  it("createModelSystemPrompt 包含 RuntimeIdentityRule（自然语言当前模型回答里禁止 provider 括号）", async () => {
    const fs = await import("node:fs");
    const promptSource = fs.readFileSync(join(SRC_ROOT, "model-prompt-runtime.ts"), "utf8");
    expect(promptSource).toContain("RuntimeIdentityRule=");
    expect(promptSource).toMatch(/Do not include provider, endpointProfile, route role, baseUrl/);
    expect(promptSource).toContain("(provider: ...)");
    expect(promptSource).toContain("openai-compatible");
  });

  it("RuntimeIdentityRule 仍允许 /model doctor 与 /model route doctor 暴露 provider", async () => {
    const fs = await import("node:fs");
    const promptSource = fs.readFileSync(join(SRC_ROOT, "model-prompt-runtime.ts"), "utf8");
    const doctorSource = fs.readFileSync(join(SRC_ROOT, "model-doctor-runtime.ts"), "utf8");
    // RuntimeIdentityRule 显式允许 /model doctor / /model route doctor 暴露 provider
    expect(promptSource).toMatch(/runs \/model doctor or \/model route doctor/);
    // 自然语言问"当前模型"被规则拦截，但 /model doctor 显式命令仍能输出 provider 字段。
    expect(doctorSource).toMatch(/provider \${providerId}/);
  });
});

describe("D.13Q-UX Real Smoke Fix v3 — Ctrl+O hint discipline", () => {
  it("短回复（单行无折叠）不带 Ctrl+O hint", () => {
    const block: ProductBlockViewModel = {
      id: "short",
      kind: "details",
      status: "info",
      title: "",
      summary: "已完成。",
      fullText: "已完成。",
    };
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const out = view.blocks.find((b) => b.id === "short");
    expect(out?.nextAction).toBeUndefined();
  });

  it("ordinary multi-line assistant block does not get a Ctrl+O hint", () => {
    const block: ProductBlockViewModel = {
      id: "multi",
      kind: "details",
      status: "info",
      title: "",
      summary: "first line",
      fullText: "first line\nsecond line\nthird line",
    };
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const out = view.blocks.find((b) => b.id === "multi");
    expect(out?.nextAction).toBeUndefined();
    expect(out?.fullText).toContain("third line");
  });

  it("Ctrl+O 展开态在 transcript block 内显示 fullText，不创建 CommandPanel", () => {
    const ctx = createContext() as TuiContext & {
      ctrlOExpandState?: { active: boolean; blockId?: string };
    };
    const block: ProductBlockViewModel = {
      id: "multi",
      kind: "details",
      status: "info",
      title: "",
      summary: "first line",
      fullText: "first line\nsecond hidden line\nthird hidden line",
      messageKind: "assistant_text",
      ctrlOCollapsed: true,
    };

    const collapsed = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    expect(renderPlainShell(collapsed)).toContain("Ctrl+O");
    expect(renderPlainShell(collapsed)).not.toContain("second hidden line");

    ctx.ctrlOExpandState = { active: true, blockId: "multi" };
    const expanded = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const rendered = renderPlainShell(expanded);
    expect(expanded.commandPanel).toBeUndefined();
    expect(rendered).toContain("second hidden line");
    expect(rendered).not.toContain("Esc 关闭面板");
    expect(rendered).not.toContain("Ctrl+O");
  });

  it("Ctrl+O 对 local/tool output 默认折叠 summary，展开后显示 fullText", () => {
    const ctx = createContext() as TuiContext & {
      ctrlOExpandState?: { active: boolean; blockId?: string };
    };
    const block: ProductBlockViewModel = {
      id: "local-long",
      kind: "tool",
      status: "pass",
      title: "",
      summary: "Bash completed",
      fullText: "Bash completed\nhidden line 1\nhidden line 2",
      messageKind: "local_command_output",
    };

    const collapsed = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const collapsedText = renderPlainShell(collapsed);
    expect(collapsedText).toContain("Bash completed");
    expect(collapsedText).toContain("Ctrl+O");
    expect(collapsedText).not.toContain("hidden line 1");

    ctx.ctrlOExpandState = { active: true, blockId: "local-long" };
    const expanded = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const expandedText = renderPlainShell(expanded);
    expect(expanded.commandPanel).toBeUndefined();
    expect(expandedText).toContain("hidden line 1");
    expect(expandedText).not.toContain("Ctrl+O");
  });

  it("再次 Ctrl+O 收起后恢复 summary 展示", () => {
    const ctx = createContext() as TuiContext & {
      ctrlOExpandState?: { active: boolean; blockId?: string };
    };
    ctx.ctrlOExpandState = { active: false };
    const view = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: [
        {
          id: "multi",
          kind: "details",
          status: "info",
          title: "",
          summary: "first line",
          fullText: "first line\nsecond hidden line\nthird hidden line",
          messageKind: "assistant_text",
          ctrlOCollapsed: true,
        },
      ],
    });

    const rendered = renderPlainShell(view);
    expect(rendered).toContain("first line");
    expect(rendered).toContain("Ctrl+O");
    expect(rendered).not.toContain("second hidden line");
  });

  it("失败块若没有可折叠正文也不挂 Ctrl+O", () => {
    const block: ProductBlockViewModel = {
      id: "short-fail",
      kind: "error",
      status: "fail",
      title: "Bash failed",
      summary: "exit 1",
      fullText: "exit 1",
      messageKind: "tool_result_error",
    };
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const out = view.blocks.find((b) => b.id === "short-fail");
    expect(out?.nextAction).toBeUndefined();
  });

  it("失败块多行正文挂 Ctrl+O 错误展开 hint", () => {
    const block: ProductBlockViewModel = {
      id: "long-fail",
      kind: "error",
      status: "fail",
      title: "Bash failed",
      summary: "exit 1",
      fullText: "exit 1\nstderr line A\nstderr line B",
      messageKind: "tool_result_error",
    };
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const out = view.blocks.find((b) => b.id === "long-fail");
    expect(out?.nextAction).toContain("Ctrl+O");
  });

  it("ProductBlock 层隐藏没有更多正文的 Ctrl+O 假提示", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const blocks: ProductBlockViewModel[] = [
      {
        id: "fake-hint",
        kind: "details",
        status: "info",
        title: "",
        summary: "ok",
        fullText: "ok",
        nextAction: "Ctrl+O 查看完整内容",
        messageKind: "assistant_text",
      },
    ];
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
          viewMode: "task",
          outputBlocks: blocks,
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

    expect(output.text).not.toContain("Ctrl+O");
  });

  it("plain renderer hides fake Ctrl+O when full text is already visible", () => {
    const block: ProductBlockViewModel = {
      id: "plain-fake-hint",
      kind: "details",
      status: "info",
      title: "",
      summary: "ok",
      fullText: "ok",
      nextAction: "Ctrl+O 查看完整内容",
      messageKind: "assistant_text",
    };
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const rendered = renderPlainShell(view);

    expect(rendered).not.toContain("Ctrl+O");
  });

  it("plain renderer folds multiline message blocks with summary+fullText", () => {
    const block: ProductBlockViewModel = {
      id: "plain-visible-multiline",
      kind: "error",
      status: "fail",
      title: "Bash failed",
      summary: "exit 1",
      fullText: "exit 1\nstderr line A\nstderr line B",
      nextAction: "按 Ctrl+O 查看完整错误",
      messageKind: "tool_result_error",
    };
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const rendered = renderPlainShell(view);

    expect(rendered).toContain("Ctrl+O");
    expect(rendered).toContain("exit 1");
    expect(rendered).not.toContain("stderr line A");
  });

  it("plain renderer keeps Ctrl+O for real hidden summary-only details", () => {
    const block: ProductBlockViewModel = {
      id: "plain-real-hidden-hint",
      kind: "error",
      status: "fail",
      title: "Bash failed",
      summary: "exit 1",
      fullText: "exit 1\nstderr line A\nstderr line B",
      nextAction: "按 Ctrl+O 查看完整错误",
    };
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    const rendered = renderPlainShell(view);

    expect(rendered).toContain("Ctrl+O");
  });

  it("ProductBlock 层保留多行错误的 Ctrl+O 完整错误提示", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const blocks: ProductBlockViewModel[] = [
      {
        id: "real-error-hint",
        kind: "error",
        status: "fail",
        title: "Bash failed",
        summary: "exit 1",
        fullText: "exit 1\nstderr line A\nstderr line B",
        nextAction: "按 Ctrl+O 查看完整错误",
        messageKind: "tool_result_error",
      },
    ];
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
          viewMode: "task",
          outputBlocks: blocks,
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

    expect(output.text).toContain("Ctrl+O");
  });
});

// ─── D.13Q-UX Task Surface Maturity Sweep ────────────────────────────────────

describe("D.13Q-UX Task Surface — ConfigPanel 装配", () => {
  it("configPanelState=panel_list 后 view.configPanel 为 panel_list", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      configPanelState: { phase: "panel_list", cursor: 0, scrollOffset: 0 },
    });
    expect(view.configPanel).toBeDefined();
    expect(view.configPanel?.phase).toBe("panel_list");
    if (view.configPanel?.phase === "panel_list") {
      expect(view.configPanel.panels.length).toBeGreaterThan(0);
    }
  });

  it("configPanelState 缺省时 view.configPanel 为 undefined", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
    });
    expect(view.configPanel).toBeUndefined();
  });
});

describe("D.13Q-UX Task Surface — CommandPanel 装配", () => {
  it("commandPanelState 装配为 view.commandPanel，含 sections / actions / detailsText", () => {
    const ctx = createContext() as TuiContext & {
      commandPanelState?: unknown;
    };
    ctx.commandPanelState = {
      title: "/mcp",
      tone: "neutral",
      summary: ["MCP 已连接：3 / 3"],
      sections: [{ title: "服务器", rows: ["server-a · ready", "server-b · ready"] }],
      actions: ["/mcp doctor"],
      detailsText: "完整 MCP 状态详细 dump …",
    };
    const view = createShellViewModel(ctx, { width: 80, viewMode: "task" });
    expect(view.commandPanel).toBeDefined();
    expect(view.commandPanel?.title).toBe("/mcp");
    expect(view.commandPanel?.summary).toEqual(["MCP 已连接：3 / 3"]);
    expect(view.commandPanel?.sections?.[0]?.rows).toContain("server-a · ready");
    expect(view.commandPanel?.actions).toContain("/mcp doctor");
    expect(view.commandPanel?.detailsText).toBeDefined();
  });

  it("无 commandPanelState 时 view.commandPanel 为 undefined", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
    });
    expect(view.commandPanel).toBeUndefined();
  });

  it("CommandPanel keeps ordinary panels quiet and only shows details/selectable short hints", async () => {
    const source = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "components", "CommandPanel.tsx"),
      "utf8",
    );

    expect(source).toContain('"zh-CN": ""');
    expect(source).toContain("Enter · x · Esc");
    expect(source).not.toContain("Ctrl+O 展开详情");
    expect(source).toContain("Ctrl+O details");
    expect(source).toContain('[hint, hasDetailsText ? detailsHint : ""].filter(Boolean).join');
  });

  it("D.14D-R P1-4: CommandPanel 空 title 不渲染顶部空框（无 ❯ 标题行）", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const ctx = createContext() as TuiContext & { commandPanelState?: unknown };
    // 空 title 面板：顶部不应出现 "❯" 空标题行。
    ctx.commandPanelState = {
      title: "",
      tone: "neutral",
      summary: ["有正文摘要XZX"],
      detailsText: "完整明细YQY",
    };
    // 带一个 output block 把 viewMode 推到 task（CommandPanel 只在 TaskLayout 渲染）。
    const blocks: ProductBlockViewModel[] = [
      { id: "b1", kind: "details", status: "info", title: "块", summary: "占位", keep: true },
    ];
    const controller = {
      getViewModel: () =>
        createShellViewModel(ctx, {
          width: output.columns,
          height: output.rows,
          outputBlocks: blocks,
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

    const text = output.text;
    expect(text).toContain("有正文摘要XZX");
    // 空 title 不渲染 "❯" 标题前缀（顶部不再是空框）。
    expect(text).not.toContain("❯ ");
  });

  it("D.14D-R P1-4: CommandPanel 有 title 时正常渲染 ❯ 标题行", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const ctx = createContext() as TuiContext & { commandPanelState?: unknown };
    ctx.commandPanelState = {
      title: "模型诊断XZX",
      tone: "neutral",
      summary: ["摘要行ABC"],
    };
    const blocks: ProductBlockViewModel[] = [
      { id: "b1", kind: "details", status: "info", title: "块", summary: "占位", keep: true },
    ];
    const controller = {
      getViewModel: () =>
        createShellViewModel(ctx, {
          width: output.columns,
          height: output.rows,
          outputBlocks: blocks,
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

    expect(output.text).toContain("模型诊断XZX");
    expect(output.text).toContain("❯");
  });

  it("普通 CommandPanel 不停用 Composer，可选任务面板才接管行操作", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    const activeConfig = source.slice(
      source.indexOf("const configPanelActive"),
      source.indexOf("const text = bufferToString"),
    );
    expect(activeConfig).not.toContain("view.commandPanel");
    expect(source).toContain("{ isActive: true }");
    expect(source).toContain('emitInput({ type: "transcript-scroll", action: "halfPageUp" })');
    expect(source).toContain('emitInput({ type: "transcript-scroll", action: "halfPageDown" })');
    expect(source).toContain("const commandPanelConsumesInput = hasSelectableCommandPanelRows");
    expect(source).toContain('emitInput({ type: "command-panel-stop" })');
  });
});

describe("D.13Q-UX Task Surface — transcriptScroll 状态", () => {
  it("transcriptScrollState 装配为 view.transcriptScroll，包含 scrollOffset 与 stickToBottom", () => {
    const ctx = createContext() as TuiContext & {
      transcriptScrollState?: { scrollOffset: number; stickToBottom: boolean };
    };
    ctx.transcriptScrollState = { scrollOffset: 4, stickToBottom: false };
    const view = createShellViewModel(ctx, { width: 80, viewMode: "task" });
    expect(view.transcriptScroll).toBeDefined();
    expect(view.transcriptScroll?.scrollOffset).toBe(4);
    expect(view.transcriptScroll?.stickToBottom).toBe(false);
  });

  it("transcriptViewportGeometry 从 context 透传给 Composer 用于真实 wheel 命中判断", () => {
    const geometry = { x: 1, y: 2, width: 80, height: 10, contentHeight: 40, topOffset: 20 };
    const ctx = createContext() as TuiContext & {
      transcriptViewportGeometry?: typeof geometry;
    };
    ctx.transcriptViewportGeometry = geometry;
    const view = createShellViewModel(ctx, { width: 80, viewMode: "task" });
    expect(view.transcriptViewportGeometry).toEqual(geometry);
  });

  it("无 transcriptScrollState 时 view.transcriptScroll 为默认 stickToBottom=true / offset=0", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
    });
    expect(view.transcriptScroll).toBeDefined();
    expect(view.transcriptScroll?.scrollOffset).toBe(0);
    expect(view.transcriptScroll?.stickToBottom).toBe(true);
  });

  it("native task transcript keeps full history instead of projecting a virtual window", () => {
    const blocks: ProductBlockViewModel[] = Array.from({ length: 1200 }, (_, index) => ({
      id: `block-${index}`,
      kind: "details",
      status: "info",
      title: "",
      summary: `assistant block ${index}`,
      fullText: `assistant block ${index}\nbody line ${index}`,
      messageKind: "assistant_text",
      keep: true,
    }));
    const ctx = createContext({
      transcriptScrollState: {
        scrollOffset: 0,
        stickToBottom: true,
        viewportHeight: 20,
        contentHeight: 2400,
      },
    });

    const view = createShellViewModel(ctx, {
      width: 100,
      height: 24,
      viewMode: "task",
      outputBlocks: blocks,
    });

    expect(view.transcriptVirtualRange).toBeUndefined();
    expect(view.blocks).toHaveLength(1200);
    expect(view.blocks.some((block) => block.id === "block-0")).toBe(true);
    expect(view.blocks.some((block) => block.id === "block-1199")).toBe(true);
  });

  it("native task transcript keeps full history even when scroll state is detached", () => {
    const blocks: ProductBlockViewModel[] = Array.from({ length: 240 }, (_, index) => ({
      id: `scroll-block-${index}`,
      kind: "details",
      status: "info",
      title: "",
      summary: `scroll block ${index}`,
      fullText: `scroll block ${index}\nline`,
      messageKind: "assistant_text",
      keep: true,
    }));
    const ctx = createContext({
      transcriptScrollState: {
        scrollOffset: 260,
        stickToBottom: false,
        viewportHeight: 18,
        contentHeight: 480,
      },
    });

    const view = createShellViewModel(ctx, {
      width: 100,
      height: 24,
      viewMode: "task",
      outputBlocks: blocks,
    });

    expect(view.transcriptScroll?.stickToBottom).toBe(false);
    expect(view.transcriptVirtualRange).toBeUndefined();
    expect(view.blocks).toHaveLength(240);
    expect(view.blocks.some((block) => block.id === "scroll-block-0")).toBe(true);
    expect(view.blocks.some((block) => block.id === "scroll-block-239")).toBe(true);
  });

  it("native full history keeps finalized assistant block while deduping streaming preview", () => {
    const blocks: ProductBlockViewModel[] = Array.from({ length: 260 }, (_, index) => ({
      id: `history-${index}`,
      kind: "details",
      status: "info",
      title: "",
      summary: `history ${index}`,
      fullText: `history ${index}\nline`,
      messageKind: "assistant_text",
      keep: true,
    }));
    blocks.push({
      id: "assistant-final-dedupe-window",
      kind: "details",
      status: "info",
      title: "",
      summary: "final",
      fullText: "final assistant text\n",
      messageKind: "assistant_text",
      keep: true,
    });
    const ctx = createContext({
      streamingAssistant: {
        id: "assistant-final-dedupe-window",
        text: "final assistant text\n",
      },
      transcriptScrollState: {
        scrollOffset: 220,
        stickToBottom: false,
        viewportHeight: 18,
        contentHeight: 540,
      },
    });

    const view = createShellViewModel(ctx, {
      width: 100,
      height: 24,
      viewMode: "task",
      outputBlocks: blocks,
    });

    expect(view.transcriptVirtualRange).toBeUndefined();
    expect(view.blocks.some((block) => block.id === "assistant-final-dedupe-window")).toBe(true);
    expect(view.streamingAssistantText).toBeUndefined();
  });

  it("unseen message pill state increments only while detached from bottom", () => {
    const ctx = createContext({
      transcriptScrollState: {
        scrollOffset: 10,
        stickToBottom: false,
        viewportHeight: 10,
        contentHeight: 40,
      },
    });
    const firstBlocks: ProductBlockViewModel[] = [
      {
        id: "u-1",
        kind: "details",
        status: "info",
        title: "",
        summary: "one",
        fullText: "one",
        messageKind: "assistant_text",
        keep: true,
      },
    ];
    const secondBlocks: ProductBlockViewModel[] = [
      ...firstBlocks,
      {
        id: "u-2",
        kind: "details",
        status: "info",
        title: "",
        summary: "two",
        fullText: "two",
        messageKind: "assistant_text",
        keep: true,
      },
    ];

    const first = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: firstBlocks,
    });
    const second = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: secondBlocks,
    });

    expect(first.unseenMessageCount).toBe(0);
    expect(second.unseenMessageCount).toBe(1);
    expect(second.visibleWorkState?.scrollDetached).toBe(true);
    expect(second.visibleWorkState?.unseenCount).toBe(1);

    ctx.transcriptScrollState = { scrollOffset: 0, stickToBottom: true };
    const bottom = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: secondBlocks,
    });
    expect(bottom.unseenMessageCount).toBe(0);
    expect(ctx.unseenMessageCount).toBe(0);
  });

  it("multi-agent wrapper workflow is hidden from the main workflow progress layer", () => {
    const ctx = createContext({
      agents: [
        {
          id: "agent-a",
          status: "running",
          displayName: "audit-a",
          mailbox: [],
          startedAt: new Date().toISOString(),
        },
      ],
      workflows: {
        enabled: true,
        templates: [],
        disabledIds: [],
        activeRuns: [
          {
            id: "workflow-agent-wrapper",
            goal: "multi-agent audit",
            status: "running",
            steps: [{ id: "s1", title: "agent fanout", status: "running" }],
            multiAgent: true,
          },
        ],
      },
    } as unknown as Partial<TuiContext>);

    const view = createShellViewModel(ctx, { width: 100, viewMode: "task" });
    expect(view.visibleWorkState?.multiAgentWorkflowRunning).toBe(true);
    expect(view.visibleWorkState?.agentsRunning).toBe(1);
    expect(view.agentProgressTree?.rows).toHaveLength(1);
    expect(view.workflowProgressView).toBeUndefined();
  });

  it("multi-agent wrapper stays hidden even after agents leave running state", () => {
    const ctx = createContext({
      agents: [
        {
          id: "agent-a",
          status: "idle",
          lastTerminalStatus: "completed",
          displayName: "audit-a",
          mailbox: [],
          startedAt: new Date().toISOString(),
        },
      ],
      workflows: {
        enabled: true,
        templates: [],
        disabledIds: [],
        activeRuns: [
          {
            id: "workflow-agent-wrapper",
            goal: "multi-agent audit",
            status: "running",
            steps: [{ id: "s1", title: "collect results", status: "running" }],
            multiAgent: true,
          },
        ],
      },
    } as unknown as Partial<TuiContext>);

    const view = createShellViewModel(ctx, { width: 100, viewMode: "task" });
    expect(view.visibleWorkState?.multiAgentWorkflowRunning).toBe(true);
    expect(view.visibleWorkState?.agentsRunning).toBe(0);
    expect(view.workflowProgressView).toBeUndefined();
  });

  it("explicit workflow remains visible as workflow progress", () => {
    const ctx = createContext({
      workflows: {
        enabled: true,
        templates: [],
        disabledIds: [],
        activeRuns: [
          {
            id: "workflow-explicit",
            goal: "release workflow",
            status: "running",
            steps: [{ id: "s1", title: "verify", status: "running" }],
            phaseGateConfirmed: true,
          },
        ],
      },
    } as unknown as Partial<TuiContext>);

    const view = createShellViewModel(ctx, { width: 100, viewMode: "task" });
    expect(view.visibleWorkState?.explicitWorkflowRunning).toBe(true);
    expect(view.workflowProgressView?.runs[0]?.id).toBe("workflow-explicit");
  });

  it("Phase 7.18: adjacent read/search/deferred tool outputs collapse into one low-noise block", () => {
    const blocks: ProductBlockViewModel[] = [
      createOutputBlock("Read(package.json)", "zh-CN", "read-start"),
      createOutputBlock("读取摘要：12 行。\npackage content raw diagnostic", "zh-CN", "read-end"),
      createOutputBlock("搜索摘要：3 处。\nraw grep result line", "zh-CN", "grep-end"),
      createOutputBlock(
        "已发现 2 个扩展工具。\nSearchExtraTools matched raw list",
        "zh-CN",
        "search-extra",
      ),
      {
        id: "assistant-after-tools",
        kind: "details",
        status: "info",
        title: "",
        summary: "后续 assistant 正文",
        fullText: "后续 assistant 正文",
        messageKind: "assistant_text",
        keep: true,
      },
    ];

    const view = createShellViewModel(createContext(), {
      width: 100,
      height: 24,
      viewMode: "task",
      outputBlocks: blocks,
    });

    const group = view.blocks.find((block) => block.id.startsWith("tool-group-"));
    expect(group?.summary).toContain("工具活动已分组");
    expect(group?.summary).toContain("读取");
    expect(group?.summary).toContain("搜索");
    expect(group?.summary).toContain("扩展工具");
    expect(group?.fullText).toContain("SearchExtraTools matched raw list");
    const primaryText = view.blocks.map((block) => `${block.title}\n${block.summary}`).join("\n");
    expect(primaryText).not.toContain("SearchExtraTools matched raw list");
    expect(view.blocks.some((block) => block.id === "assistant-after-tools")).toBe(true);
  });

  it("tool output blocks use tool_result_success semantics instead of assistant text", () => {
    const readBlock = createOutputBlock("Read(package.json)\n- 12 行", "zh-CN", "read-tool");
    const editBlock = createOutputBlock("Edit summary: patch +1 -1", "en-US", "edit-tool");
    const assistantBlock = createOutputBlock("我会先看 package.json。", "zh-CN", "assistant");

    expect(readBlock.messageKind).toBe("tool_result_success");
    expect(editBlock.messageKind).toBe("tool_result_success");
    expect(assistantBlock.messageKind).toBe("assistant_text");
  });

  it("web search and normal chat blocks keep full text for output-layer wrapping", () => {
    const searchText =
      "Search summary\nhttps://example.com/very/long/path/that/should/wrap/inside/the/task/output/content/column";
    const chatText =
      "This is a normal assistant paragraph that should stay intact so MessageMarkdown can wrap it at the current viewport width.";
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 42,
      height: 18,
      viewMode: "task",
      outputBlocks: [
        createOutputBlock(searchText, "en-US", "search-wrap"),
        createOutputBlock(chatText, "en-US", "chat-wrap"),
      ],
    });

    const search = view.blocks.find((block) => block.id === "search-wrap");
    const chat = view.blocks.find((block) => block.id === "chat-wrap");

    expect(search?.messageKind).toBe("tool_result_success");
    expect(search?.fullText).toBe(searchText);
    expect(search?.summary).toBe(searchText);
    expect(chat?.messageKind).toBe("assistant_text");
    expect(chat?.fullText).toBe(chatText);
    expect(chat?.summary).toBe(chatText);
  });

  it("Task output uses real content width for blocks, streaming text, and status", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    const taskStart = source.indexOf("function TaskLayout(");
    const taskEnd = source.indexOf("function taskContentWidth", taskStart);
    const taskBody = source.slice(taskStart, taskEnd);
    const widthFn = source.slice(taskEnd, source.indexOf("function taskComposerLayout", taskEnd));
    const activityStart = source.indexOf("function TaskActivityRegion(");
    const activityEnd = source.indexOf("function taskComposerLayout", activityStart);
    const activityBody = source.slice(activityStart, activityEnd);
    const bottomPaneSource = await readFile(
      join(SRC_ROOT, "shell/components/TaskBottomPane.tsx"),
      "utf8",
    );

    expect(taskBody).toContain("const contentWidth = taskContentWidth(view.width)");
    expect(taskBody).toContain("contentWidth={contentWidth}");
    expect(activityBody).toContain("wrapWidth={contentWidth}");
    expect(activityBody).toContain("<ActivityIndicator");
    expect(bottomPaneSource).toContain("width={contentWidth}");
    expect(taskBody).toContain("flexGrow={1}");
    expect(taskBody).toContain("minHeight={0}");
    expect(taskBody).toContain("<TranscriptViewport");
    expect(widthFn).toContain("return Math.max(8, viewWidth - 4)");
    expect(widthFn).not.toContain("viewWidth - 6");
  });

  it("OutputLine truncation accounts for its left padding before wrapping", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/OutputLine.tsx"), "utf8");

    expect(source).toContain("OUTPUT_LINE_PADDING_LEFT");
    expect(source).toContain("terminalWidth - OUTPUT_LINE_PADDING_LEFT");
    expect(source).toContain("renderTruncatedContent(formatted, contentWidth, language)");
    expect(source).toContain("paddingLeft={OUTPUT_LINE_PADDING_LEFT}");
  });

  it("StructuredDiff follows available wrap width and pads colored rows", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/StructuredDiff.tsx"), "utf8");

    expect(source).not.toContain("Math.min(wrapWidth, 60)");
    expect(source).toContain("borderChar.repeat(safeWrapWidth)");
    expect(source).toContain("const gutterWidth = lineNumberWidth * 2 + 5");
    expect(source).toContain("const oldText = formatLineNumber(line.oldLine, lineNumberWidth)");
    expect(source).toContain("const newText = formatLineNumber(line.newLine, lineNumberWidth)");
    expect(source).toContain("const continuationGutter");
    expect(source).toContain("padDisplay(wrappedLine, contentWidth)");
    expect(source).toContain("displayWidth(value)");
  });

  it("StructuredDiff reuses the shared diff parser instead of duplicating parsing", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/StructuredDiff.tsx"), "utf8");

    expect(source).toContain("parseDiffLines");
    expect(source).toContain("../diff-renderer.js");
    expect(source).not.toContain("function parseDiffLines(");
    expect(source).not.toContain("type DiffLine =");
  });

  it("plain diff rendering accepts ShellTheme semantic colors", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/diff-renderer.ts"), "utf8");
    const plainSource = await readFile(join(SRC_ROOT, "shell/plain-renderer.ts"), "utf8");

    expect(source).toContain("theme?: ShellTheme");
    expect(source).toContain("theme?.diffAddedWord ?? theme?.success");
    expect(source).toContain("theme?.diffRemovedWord ?? theme?.error");
    expect(source).toContain("ansiColorCode(color)");
    expect(plainSource).toContain("createShellTheme(noColor)");
    expect(plainSource).toContain("theme: options.theme");
  });

  it("diff rendering entry points use the shared diff fence language gate", async () => {
    const { readFile } = await import("node:fs/promises");
    const messageMarkdownSource = await readFile(
      join(SRC_ROOT, "shell/components/MessageMarkdown.tsx"),
      "utf8",
    );
    const terminalSurfaceSource = await readFile(join(SRC_ROOT, "tui-output-surface.ts"), "utf8");

    for (const source of [messageMarkdownSource, terminalSurfaceSource]) {
      expect(source).toContain("isDiffFenceLanguage");
      expect(source).not.toContain('lang === "diff"');
      expect(source).not.toContain('lang === "patch"');
    }
    expect(messageMarkdownSource).toContain("../diff-renderer.js");
    expect(terminalSurfaceSource).toContain("./shell/diff-renderer.js");
  });

  it("MessageMarkdown code rows pad to wrapWidth for whole-line visual consistency", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/MessageMarkdown.tsx"), "utf8");

    expect(source).toContain("padDisplay(wrapped, wrapWidth)");
    expect(source).toContain("displayWidth(stripAnsi(value))");
    expect(source).toContain("wrapText(line, effectiveWrapWidth)");
  });

  it("MessageMarkdown table header cells are centered", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/MessageMarkdown.tsx"), "utf8");

    expect(source).toContain("function centerPadDisplay(");
    expect(source).toContain("boldHeader");
    expect(source).toContain("centerPadDisplay(cell.lines[lineIndex] ?? \"\", cell.width)");
  });

  it("StreamingMarkdown does not render an accent cursor marker", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/MessageMarkdown.tsx"), "utf8");

    expect(source).not.toContain("<Text color={theme.accent}>{\"▌\"}</Text>");
  });

  it("wheel scroll runtime dispatches microtask batches without slow row quantization", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/hooks/useScrollRuntime.ts"), "utf8");

    expect(source).toContain("queueMicrotask");
    expect(source).not.toContain("SCROLL_QUANTUM");
    expect(source).not.toContain("DRAIN_INTERVAL_MS");
  });

  it("MessageMarkdown selection rows still use effective wrap width", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/MessageMarkdown.tsx"), "utf8");

    expect(source).toContain("function splitSelectionRows(");
    expect(source).toContain("wrapWidth={effectiveWrapWidth}");
  });

  it("MessageMarkdown hard-wraps URLs, HTML entities, web search rows, and no-space strings", () => {
    const cases = [
      "https://example.com/very/long/path/without/spaces?query=abcdef",
      "Result 1 https://example.com/search/result/with/a/very/long/url&rank=1",
      "alpha&amp;beta&amp;gamma&amp;delta&amp;epsilon&amp;zeta",
      "averyveryveryverylongstringwithoutspaces",
    ];

    for (const value of cases) {
      const rows = __testWrapInlineMarkdownRows(value, 12);
      expect(rows.length).toBeGreaterThan(1);
      for (const row of rows) {
        const text = row.map((token) => token.value).join("");
        expect(displayWidth(text)).toBeLessThanOrEqual(12);
      }
      expect(rows.flatMap((row) => row.map((token) => token.value)).join("")).toBe(value);
    }
  });

  it("MessageMarkdown hard-wrap keeps inline style token kinds across rows", () => {
    const rows = __testWrapInlineMarkdownRows(
      "`abc` **abcdefghijklmnopqrstuvwxyz**",
      10,
    );
    expect(rows.some((row) => row.some((token) => token.kind === "code"))).toBe(true);
    expect(rows.some((row) => row.some((token) => token.kind === "bold"))).toBe(true);
    for (const row of rows) {
      expect(displayWidth(row.map((token) => token.value).join(""))).toBeLessThanOrEqual(10);
    }
  });

  it("MessageMarkdown routes raw unfenced diffs to StructuredDiff and drops Git CRLF advisory noise", () => {
    const segments = __testSplitRawDiffSections(
      [
        "下面是改动：",
        "[stderr] warning: in the working copy of 'app.js', LF will be replaced by CRLF the next time Git touches it",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/app.js",
        "+function add(...values) {",
        "+  return values.reduce((sum, value) => sum + value, 0);",
        "+}",
        "",
        "以上是结果。",
      ].join("\n"),
    );

    expect(segments.map((segment) => segment.kind)).toEqual(["markdown", "diff", "markdown"]);
    expect(segments[1]?.text).toContain("+++ b/app.js");
    expect(segments.map((segment) => segment.text).join("\n")).not.toContain("LF will be replaced");
  });

  it("Phase R2: two adjacent read/search tool outputs stay separate", () => {
    const blocks: ProductBlockViewModel[] = [
      createOutputBlock("Read(src/a.ts)", "zh-CN", "read-a"),
      createOutputBlock("Glob(src/**/*.ts)", "zh-CN", "glob-b"),
    ];

    const view = createShellViewModel(createContext(), {
      width: 100,
      height: 24,
      viewMode: "task",
      outputBlocks: blocks,
    });

    expect(view.blocks.some((block) => block.id.startsWith("tool-group-"))).toBe(false);
    expect(view.blocks.map((block) => block.id)).toEqual(["read-a", "glob-b"]);
  });

  it("Phase 7.18: tool grouping does not cross assistant text or hide failed tool diagnostics", () => {
    const failedTool: ProductBlockViewModel = {
      id: "grep-failed",
      kind: "tool",
      status: "fail",
      title: "Grep failed",
      summary: "Grep failed: permission denied",
      fullText: "Grep failed: raw diagnostic stack",
      messageKind: "tool_result_error",
      keep: true,
    };
    const blocks: ProductBlockViewModel[] = [
      createOutputBlock("Read(src/a.ts)", "en-US", "read-a"),
      {
        id: "assistant-break",
        kind: "details",
        status: "info",
        title: "",
        summary: "I will inspect the next file separately.",
        fullText: "I will inspect the next file separately.",
        messageKind: "assistant_text",
        keep: true,
      },
      createOutputBlock("Glob(src/**/*.ts)\nraw glob diagnostic", "en-US", "glob-b"),
      failedTool,
    ];

    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 100,
      height: 24,
      viewMode: "task",
      outputBlocks: blocks,
    });

    expect(view.blocks.some((block) => block.id.startsWith("tool-group-"))).toBe(false);
    expect(view.blocks.map((block) => block.id)).toEqual([
      "read-a",
      "assistant-break",
      "glob-b",
      "grep-failed",
    ]);
    const failed = view.blocks.find((block) => block.id === "grep-failed");
    expect(failed?.status).toBe("fail");
    expect(`${failed?.summary}\n${failed?.fullText}`).toContain("raw diagnostic stack");
  });

  it("transcriptSelectionState 给 app-owned transcript selection 挂可见高亮 cell 范围", () => {
    const ctx = createContext() as TuiContext & {
      transcriptSelectionState?: {
        dragging: boolean;
        anchor: { row: number; column: number };
        focus: { row: number; column: number };
      };
    };
    ctx.transcriptSelectionState = {
      dragging: true,
      anchor: { row: 0, column: 0 },
      focus: { row: 1, column: 4 },
    };
    const block = {
      id: "assistant-selection",
      kind: "details",
      status: "info",
      title: "",
      summary: "第一行",
      fullText: "第一行\n第二行\n第三行",
      messageKind: "assistant_text",
    } satisfies ProductBlockViewModel;

    const view = createShellViewModel(ctx, {
      width: 80,
      viewMode: "task",
      outputBlocks: [block],
    });
    expect(view.blocks[0]?.selectionLineIndexes).toEqual([0, 1]);
    expect(view.blocks[0]?.selectionLineRanges).toEqual([
      { lineIndex: 0, startColumn: 0, endColumn: 6 },
      { lineIndex: 1, startColumn: 0, endColumn: 4 },
    ]);
    expect(view.blocks[0]?.fullText).toBe("第一行\n第二行\n第三行");
  });
});

describe("D.14D explicit details summary-first panel", () => {
  it("D.14D-R2 P3-2: end-to-end presenter→block 同一工具输出块只剩一次 Ctrl+O（回归锁定）", () => {
    // CLOSED_BY_D14D_R 复核：真实 formatToolOutput 正文不再携带折叠提示；
    // createOutputBlock 装配后，ink 主屏只通过 nextAction 出现一次 Ctrl+O。
    const bashStdout = Array.from({ length: 8 }, (_, index) => `bash line ${index + 1}`).join(
      "\n",
    );
    const presenterBody = formatToolOutput(
      "Bash",
      { text: bashStdout, data: { exitCode: 0, lines: 8 } },
      "zh-CN",
    );
    expect(presenterBody).not.toContain("Ctrl+O");
    const block = createOutputBlock(presenterBody, "zh-CN", "out-e2e");
    expect(block.fullText).not.toContain("输出已折叠");
    expect(block.nextAction).toContain("Ctrl+O");
    const rendered = `${block.fullText ?? ""}\n${block.nextAction ?? ""}`;
    expect(rendered.match(/Ctrl\+O/g)?.length).toBe(1);
  });

  it("D.14D-R P1-1: tool 输出块同一块只出现一次 Ctrl+O 提示（内嵌折叠行被剥离）", () => {
    // 模拟 tool-output-presenter 产出的正文：摘要 + 内嵌折叠提示行。
    const body = ["工具 Read 已完成", "- 120 行", "- 输出已折叠，按 Ctrl+O 展开。"].join("\n");
    const block = createOutputBlock(body, "zh-CN", "out-fold");
    // 正文内嵌的折叠提示行已被剥离，不再出现在 fullText/summary 里。
    expect(block.fullText).not.toContain("输出已折叠");
    // ink 主屏的 Ctrl+O 提示统一由 nextAction 渲染（单一来源）。
    expect(block.nextAction).toContain("Ctrl+O");
    // 渲染层只剩一处 Ctrl+O：fullText + nextAction 合计仅一次。
    const rendered = `${block.fullText ?? ""}\n${block.nextAction ?? ""}`;
    expect(rendered.match(/Ctrl\+O/g)?.length).toBe(1);
  });

  it("D.14D-R P1-1: 英文 tool 输出块同样只保留一次 Ctrl+O 提示", () => {
    const body = [
      "Tool Read completed",
      "- 30 line(s)",
      "- Output folded. Press Ctrl+O to expand.",
    ].join("\n");
    const block = createOutputBlock(body, "en-US", "out-fold-en");
    expect(block.fullText).not.toContain("Output folded");
    expect(block.nextAction).toContain("Ctrl+O");
    const rendered = `${block.fullText ?? ""}\n${block.nextAction ?? ""}`;
    expect(rendered.match(/Ctrl\+O/g)?.length).toBe(1);
  });

  it("legacy stdout hidden hint 被清洗，Ctrl+O 只由 nextAction 渲染", () => {
    const body = [
      "Tool Bash completed",
      "- 40 行",
      "[stdout] ... 更多输出已隐藏；按 Ctrl+O 展开。",
    ].join("\n");
    const block = createOutputBlock(body, "zh-CN", "out-stdout-hidden");
    expect(block.fullText).not.toContain("更多输出已隐藏");
    expect(block.nextAction).toContain("Ctrl+O");
    const rendered = `${block.fullText ?? ""}\n${block.nextAction ?? ""}`;
    expect(rendered.match(/Ctrl\+O/g)?.length).toBe(1);
  });

  it("Read summary-first 长输出正文不带 Ctrl+O，但 block 保留统一展开入口", () => {
    const presenterBody = formatToolOutput(
      "Read",
      { text: "line\n".repeat(150), data: { lines: 150, totalLines: 150 } },
      "zh-CN",
    );
    expect(presenterBody).not.toContain("Ctrl+O");
    const block = createOutputBlock(presenterBody, "zh-CN", "read-long");
    expect(block.nextAction).toContain("Ctrl+O");
    const rendered = `${block.fullText ?? ""}\n${block.nextAction ?? ""}`;
    expect(rendered.match(/Ctrl\+O/g)?.length).toBe(1);
  });

  it("短的两行输出不生成虚假的 Ctrl+O 提示", () => {
    const block = createOutputBlock("状态正常\n没有隐藏内容", "zh-CN", "short-two-lines");
    expect(block.fullText).toBe("状态正常\n没有隐藏内容");
    expect(block.nextAction).toBeUndefined();
  });

  it("有 lastFullOutput 时返回 panel：summary-first，正文只进 detailsText，默认折叠", () => {
    const ctx = createContext() as TuiContext & { lastFullOutput?: string };
    ctx.lastFullOutput = "完整 /model doctor 多行输出\n provider.env merge=...\nproviders=...";
    ctx.evidence = [];
    ctx.backgroundTasks = [];
    const panel = __testBuildExplicitDetailsCommandPanel(ctx);
    expect(panel).toBeDefined();
    // 完整正文只进 detailsText（显式详情面板），不进 summary/section 主屏行。
    expect(panel?.detailsText).toContain("完整 /model doctor");
    // D.14D：默认折叠（summary-first）；默认看摘要，panel 内显式展开 detailsText。
    expect(panel?.expanded).toBe(false);
    expect(panel?.actions).toContain("/details");
    // 主屏 section 行不得包含完整正文。
    const sectionRows = (panel?.sections ?? []).flatMap((s) => s.rows).join("\n");
    expect(sectionRows).not.toContain("provider.env merge");
  });

  it("有 evidence 时主屏 sections 只给计数/kind 摘要，不泄漏 id/source；id 只进 detailsText", () => {
    const ctx = createContext() as TuiContext;
    ctx.lastFullOutput = undefined;
    ctx.evidence = [
      {
        id: "ev-1",
        kind: "file",
        source: "Read",
        summary: "package.json read",
        createdAt: new Date().toISOString(),
      },
    ] as unknown as TuiContext["evidence"];
    ctx.backgroundTasks = [];
    const panel = __testBuildExplicitDetailsCommandPanel(ctx);
    expect(panel).toBeDefined();
    expect(
      panel?.sections?.some((s) => s.title?.includes("证据") || s.title?.includes("Evidence")),
    ).toBe(true);
    // 主屏 section 行不得泄漏内部 id / source。
    const sectionRows = (panel?.sections ?? []).flatMap((s) => s.rows).join("\n");
    expect(sectionRows).not.toContain("ev-1");
    expect(sectionRows).not.toContain("Read");
    // id 仍可在展开层（detailsText）查看。
    expect(panel?.detailsText).toContain("ev-1");
  });

  it("有 backgroundTasks 时主屏只给运行/失败计数，不泄漏 id；id 只进 detailsText", () => {
    const ctx = createContext() as TuiContext;
    ctx.lastFullOutput = undefined;
    ctx.evidence = [];
    ctx.backgroundTasks = [
      {
        id: "bg-1",
        kind: "bash",
        title: "node --version",
        status: "running",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userVisibleSummary: "running node --version",
      },
    ] as unknown as TuiContext["backgroundTasks"];
    const panel = __testBuildExplicitDetailsCommandPanel(ctx);
    expect(panel).toBeDefined();
    expect(
      panel?.sections?.some((s) => s.title?.includes("后台") || s.title?.includes("Background")),
    ).toBe(true);
    const sectionRows = (panel?.sections ?? []).flatMap((s) => s.rows).join("\n");
    expect(sectionRows).not.toContain("bg-1");
    expect(panel?.detailsText).toContain("bg-1");
  });

  it("malformed blocked backgroundTasks still render details instead of throwing", () => {
    const ctx = createContext() as TuiContext;
    ctx.lastFullOutput = undefined;
    ctx.evidence = [];
    ctx.backgroundTasks = [
      {
        id: "bg-blocked-old",
        status: "blocked",
      },
    ] as unknown as TuiContext["backgroundTasks"];

    expect(() => __testBuildExplicitDetailsCommandPanel(ctx)).not.toThrow();
    const panel = __testBuildExplicitDetailsCommandPanel(ctx);
    expect(panel?.detailsText).toContain("bg-blocked-old");
    expect(panel?.detailsText).toContain("background");
  });

  it("多源组合时分区齐全（最近输出 / 证据 / 后台），detailsText 不互相套娃", () => {
    const ctx = createContext() as TuiContext & { lastFullOutput?: string };
    ctx.lastFullOutput = "最近输出正文";
    ctx.evidence = [
      {
        id: "ev-9",
        kind: "grep_result",
        source: "Grep",
        summary: "matched 3",
        createdAt: new Date().toISOString(),
      },
    ] as unknown as TuiContext["evidence"];
    ctx.backgroundTasks = [
      {
        id: "bg-9",
        kind: "bash",
        title: "build",
        status: "failed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userVisibleSummary: "build failed",
      },
    ] as unknown as TuiContext["backgroundTasks"];
    const panel = __testBuildExplicitDetailsCommandPanel(ctx);
    expect(panel?.sections?.length).toBe(3);
    // detailsText 只出现一次每个分区标题（无套娃重复）。
    const evidenceHeaders = (panel?.detailsText ?? "").match(/## (证据|Evidence)/g) ?? [];
    expect(evidenceHeaders.length).toBe(1);
  });

  it("三类内容全空时返回 undefined（调用方应走 notifications，不写 transcript）", () => {
    const ctx = createContext() as TuiContext;
    ctx.lastFullOutput = undefined;
    ctx.evidence = [];
    ctx.backgroundTasks = [];
    const panel = __testBuildExplicitDetailsCommandPanel(ctx);
    expect(panel).toBeUndefined();
  });
});

describe("D.14D-C — scroll hint noise + activity placement", () => {
  const SCROLL_HINT_ZH = "滚轮/PgUp/PgDn 滚动 · End 回到底部";
  const SCROLL_HINT_EN = "Wheel/PgUp/PgDn to scroll · End to bottom";

  it("scroll hint 文案不进 transcript（view.blocks 任何字段都不含）", () => {
    const blocks: ProductBlockViewModel[] = [
      {
        id: "out-1",
        kind: "details",
        status: "info",
        title: "结果",
        summary: "一些输出",
        keep: true,
      },
    ];
    const view = createShellViewModel(createContext(), {
      width: 80,
      outputBlocks: blocks,
      activity: { phase: "thinking", text: "正在思考…" },
    });
    const serialized = JSON.stringify(view.blocks);
    expect(serialized).not.toContain(SCROLL_HINT_ZH);
    expect(serialized).not.toContain(SCROLL_HINT_EN);
    expect(serialized).not.toContain("PgUp");
  });

  it("activity 暴露在 view 上（与 blocks 分离，供 ShellApp 在块之后渲染）", () => {
    const blocks: ProductBlockViewModel[] = [
      { id: "out-1", kind: "details", status: "info", title: "t", summary: "s", keep: true },
    ];
    const view = createShellViewModel(createContext(), {
      width: 80,
      outputBlocks: blocks,
      activity: { phase: "thinking", text: "正在思考…" },
    });
    expect(view.activity?.text).toBe("正在思考…");
    // activity 不混进 blocks。
    expect(view.blocks.some((b) => b.summary === "正在思考…")).toBe(false);
  });

  it("Ink task 渲染：activity 出现在最新块之后（底部对话流）", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_TUI_NATIVE_SCROLLBACK", "0");
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const blocks: ProductBlockViewModel[] = [
      {
        id: "u1",
        kind: "command",
        status: "info",
        title: "用户最早的消息标记XZX",
        summary: "用户最早的消息标记XZX",
        messageKind: "user_text",
        keep: true,
      },
    ];
    const controller = {
      getViewModel: () =>
        createShellViewModel(createContext(), {
          width: output.columns,
          height: output.rows,
          outputBlocks: blocks,
          activity: { phase: "thinking", text: "活动标记QWQ" },
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

    const text = output.text;
    const blockPos = text.indexOf("用户最早的消息标记XZX");
    const activityPos = text.indexOf("活动标记QWQ");
    expect(blockPos).toBeGreaterThanOrEqual(0);
    expect(activityPos).toBeGreaterThanOrEqual(0);
    expect(activityPos).toBeGreaterThan(blockPos);
  });

  it("Ink task 渲染：滚动状态下主屏不再出现常驻 scroll hint 行", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    const output = new TestTtyOutput();
    const input = createTtyInput();
    const blocks: ProductBlockViewModel[] = [
      { id: "o1", kind: "details", status: "info", title: "块", summary: "内容", keep: true },
    ];
    const controller = {
      getViewModel: () =>
        createShellViewModel(
          createContext({ transcriptScrollState: { scrollOffset: 5, stickToBottom: false } }),
          {
            width: output.columns,
            height: output.rows,
            outputBlocks: blocks,
          },
        ),
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

    expect(output.text).not.toContain(SCROLL_HINT_ZH);
    expect(output.text).not.toContain("PgUp");
    expect(output.text).not.toContain("PgDn");
  });
});
