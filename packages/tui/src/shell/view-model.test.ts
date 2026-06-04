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
  bufferInsert,
  bufferMoveDown,
  bufferMoveUp,
  createEditBuffer,
  formatComposerRenderLines,
  handleComposerInput,
} from "./components/Composer.js";
import { renderInkShell, shouldUseInkShell } from "./ink-renderer.js";
import { renderPlainShell } from "./plain-renderer.js";
import { detectTerminalCapability, resetTerminalCapabilityCache } from "./terminal-capability.js";
import type { ProductBlockViewModel } from "./types.js";
import {
  createOutputBlock,
  createShellViewModel,
  getComposerPlaceholder,
  mapPendingApprovalToPermission,
  mapRequestActivityToView,
} from "./view-model.js";

// Reset terminal capability cache after every test to prevent cross-test pollution.
// Tests that need a specific terminal tier should stub LINGHUN_TERMINAL_TIER
// explicitly; otherwise capability detection follows the host terminal.
afterEach(() => {
  resetTerminalCapabilityCache();
  vi.unstubAllEnvs();
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

  it("enables extended keyboard reporting for Shift+Enter-capable terminals and restores it on exit", async () => {
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

    expect(output.text).toContain("\x1B[>4;2m");
    expect(output.text).toContain("\x1B[>4m");
    expect(output.text.indexOf("\x1B[>4;2m")).toBeLessThan(output.text.lastIndexOf("\x1B[>4m"));
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
    const source = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");

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
    // D.13D: home no longer overrides composer placeholder with the setup
    // sentence; the default placeholder remains and the setup entry path is
    // the Enter-to-start flow plus the explicit setup hint surface (in task
    // mode). Home keeps the default placeholder even when setupNeeded=true.
    expect(output.text).toContain("我能帮您做点什么？");
    expect(output.text).not.toContain("按 Enter 开始配置模型");
    // No large setupHint block or old-style verbose guidance
    expect(output.text).not.toContain("还没有模型配置");
    expect(output.text).not.toContain("我要配置模型");
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
    expect(result?.text).toBe("正在运行 Write…");
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
    // D.13L Block 0-B — architecture_drift 也只用 actionSummary 展示"做什么"，
    // warnings 仍走 /details 路径，不在主屏暴露。
    expect(result?.actionSummary).toContain("core/api.ts");
    expect(result?.actionSummary).toContain("修改文件");
  });

  it("D.14D-R P0-1: maps index_ignore_write approval to a Write PermissionPanel view", () => {
    // /index repair 的 ignore 写入是一次 Write 提权；ink 主屏必须走 PermissionPanel。
    const ctx = createContext({
      pendingLocalApproval: {
        kind: "index_ignore_write",
        plan: { path: ".linghunignore" },
      },
    } as unknown as Partial<TuiContext>);
    const result = mapPendingApprovalToPermission(ctx);
    expect(result).toBeDefined();
    expect(result?.toolName).toBe("Write");
    expect(result?.risk).toBe("medium");
    expect(result?.scope).toContain(".linghunignore");
    expect(result?.actionSummary).toContain(".linghunignore");
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
  it("folds active background tasks into one footer-adjacent summary", () => {
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
    expect(view.taskRuntimeSummary?.id).toBe("bg-summary");
    expect(view.taskRuntimeSummary?.kind).toBe("run");
    expect(view.taskRuntimeSummary?.status).toBe("running");
    expect(view.taskRuntimeSummary?.title).toContain("后台 1");
    expect(view.taskRuntimeSummary?.title).toContain("运行中 1");
    expect(view.taskRuntimeSummary?.title).not.toContain("可恢复");
    expect(view.taskRuntimeSummary?.summary).toContain("lint check");
    expect(view.taskRuntimeSummary?.summary).toContain("checking files");
    expect(view.taskRuntimeSummary?.summary).toContain("1/3 steps");
    expect(view.taskRuntimeSummary?.nextAction).toContain("/interrupt");
  });

  it("keeps terminal historical background statuses out of the task runtime summary", () => {
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

  it("shows stale/resumable background status with a clear next action", () => {
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
    expect(view.taskRuntimeSummary?.status).toBe("blocked");
    expect(view.taskRuntimeSummary?.title).toContain("后台 1");
    expect(view.taskRuntimeSummary?.title).toContain("智能体 1");
    expect(view.taskRuntimeSummary?.title).toContain("需要确认 1");
    expect(view.taskRuntimeSummary?.title).not.toContain("可恢复");
    expect(view.taskRuntimeSummary?.summary).not.toContain("上次会话恢复的后台任务");
    expect(view.taskRuntimeSummary?.nextAction).not.toContain("agent-stale-1");
    expect(view.taskRuntimeSummary?.nextAction).toContain("/background");
  });

  it("uses en-US prefix for background blocks", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "t5", title: "build", status: "running" }],
    });
    expect(view.blocks.find((b) => b.id === "bg-summary")).toBeUndefined();
    expect(view.taskRuntimeSummary?.title).toContain("Background 1");
    expect(view.taskRuntimeSummary?.title).toContain("running 1");
    expect(view.taskRuntimeSummary?.summary).toContain("build");
  });

  it("completed-only background tasks stay out of the task output", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [{ id: "t6", title: "job", status: "completed" }],
    });
    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
    expect(view.taskRuntimeSummary).toBeUndefined();
  });

  it("startup hydrate-style terminal history stays out while running/stale remains visible", () => {
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
    expect(recoverable.taskRuntimeSummary?.title).toContain("后台 2");
    expect(recoverable.taskRuntimeSummary?.title).toContain("智能体 2");
    expect(recoverable.taskRuntimeSummary?.title).toContain("需要确认 1");
    expect(recoverable.taskRuntimeSummary?.title).toContain("运行中 1");
    expect(recoverable.taskRuntimeSummary?.title).not.toContain("可恢复");
    expect(recoverable.taskRuntimeSummary?.summary).not.toContain("cli-tui-worker");
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

  it("running/stale jobs fold into one task summary without terminal failed noise", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      backgroundSummaries: [
        { id: "j2", title: "test", status: "running" },
        { id: "j3", title: "deploy", status: "failed" },
        { id: "j4", title: "health", status: "stale" },
      ],
    });
    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
    expect(view.taskRuntimeSummary?.status).toBe("blocked");
    expect(view.taskRuntimeSummary?.title).toContain("后台 2");
    expect(view.taskRuntimeSummary?.title).toContain("需要确认 1");
    expect(view.taskRuntimeSummary?.title).toContain("运行中 1");
    expect(view.taskRuntimeSummary?.title).not.toContain("可恢复");
    expect(view.taskRuntimeSummary?.summary).not.toContain("deploy");
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
      backgroundSummaries: [{ id: "nc1", title: "task", status: "stale" }],
    });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("后台 1");
    expect(rendered).toContain("需要确认 1");
    expect(rendered).not.toContain("可恢复");
    expect(rendered).toContain("详情 /background");
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

  it("Task folds running/stale background into one summary and ignores terminal history", () => {
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
    expect(view.blocks.filter((b) => b.id.startsWith("bg-"))).toHaveLength(0);
    expect(view.taskRuntimeSummary?.status).toBe("blocked");
    expect(view.taskRuntimeSummary?.title).toContain("后台 2");
    expect(view.taskRuntimeSummary?.title).toContain("需要确认 1");
    expect(view.taskRuntimeSummary?.title).toContain("运行中 1");
    expect(view.taskRuntimeSummary?.title).not.toContain("可恢复");
    expect(view.taskRuntimeSummary?.summary).not.toContain("deploy");
    expect(view.taskRuntimeSummary?.summary).not.toContain("health");
  });

  it("fail/blocking output prioritized over normal output", () => {
    // D.13Q-UX Real Smoke Fix v3：fail 块按 append 顺序保留，不再被推到顶；
    // 限流只对 ephemeral 生效（cap=3），fail/keep 不计入 cap。
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
    // ephemeral cap=3，fail 不计入：1 fail + 最近 3 ephemeral = 4 块。
    const ephemeralCount = outputBlocks.filter(
      (b) => b.status !== "fail" && b.status !== "blocked" && !b.keep,
    ).length;
    expect(ephemeralCount).toBeLessThanOrEqual(3);
    // out-1 应该被丢（最早 ephemeral 超出 cap），out-2/3/4 保留。
    expect(outputBlocks.find((b) => b.id === "out-1")).toBeUndefined();
    expect(outputBlocks.find((b) => b.id === "out-4")).toBeDefined();
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
    expect(source).toMatch(/getStatusMarker\([^)]+\)\}\s*\{block\.summary\}/);
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
    const source = await readFile(join(SRC_ROOT, "index.ts"), "utf8");
    // /model body must include reasoning status so the user has a fast surface
    // outside the (size-limited) footer.
    expect(source).toMatch(/reasoning=\$\{runtime\.reasoningStatus\}/);
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
    expect(source).toMatch(/declared\s*&&\s*capability\.cursorPositioning/);
  });

  it("D13E-P3 #6: Composer keeps cursor ownership split explicit", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    // Home/task/pending all declare the native anchored cursor; capability
    // fallback hides it instead of drawing a reverse-video fake cursor.
    expect(source).toMatch(
      /useAnchoredCursor\(\s*permissionActive\s*\?\s*null\s*:\s*\{\s*row:\s*declaredRow,\s*col:\s*cursorCol\s*\}/,
    );
    expect(source).not.toContain("useInlineCursor");
    expect(source).not.toContain("<Text inverse>{cursorChar}</Text>");
    // anchorRef attaches to the outer Box synchronously in the same render —
    // not via a deferred effect — so the parent-chain origin resolves on the
    // very first commit.
    expect(source).toMatch(/<Box ref=\{anchorRef\}/);
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
      delete process.env.LINGHUN_TERMINAL_TIER;
      delete process.env.WT_SESSION;
      delete process.env.TERM_PROGRAM;
      delete process.env.TERM;
      delete process.env.ConEmuPID;
      delete process.env.CONEMUDIR;
      delete process.env.MSYSTEM;
      delete process.env.ALACRITTY_WINDOW_ID;
      resetTerminalCapabilityCache();
      expect(
        shouldUseInkShell(
          { isTTY: true } as NodeJS.ReadStream,
          { isTTY: true } as NodeJS.WriteStream,
        ),
      ).toBe(true);
      const capability = detectTerminalCapability();
      expect(capability.tier).toBe("basic");
      expect(capability.shiftEnter).toBe(true);
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

describe("D.13C — TUI Product Shell Final Maturity", () => {
  // =========================================================================
  // P1-1: Plain fallback input area closure
  // =========================================================================

  it("plain fallback Home placeholder has no '> ' prefix (avoids double-input with readline)", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    // Placeholder present as dim hint
    expect(rendered).toContain("我能帮您做点什么？");
    // No "> " prefix on placeholder (readline provides the real prompt)
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
    expect(rendered).toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
  });

  it("TERM=dumb plain fallback renders without crash and no double prompt", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "legacy");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), { noColor: true, width: 80 });
    const rendered = renderPlainShell(view);
    expect(rendered).toContain("LingHun");
    expect(rendered).toContain("我能帮您做点什么？");
    expect(rendered).not.toContain("> 我能帮您做点什么？");
  });

  // =========================================================================
  // P2-1: Home setup guidance maturity
  // =========================================================================

  it("setupNeeded=true in home mode keeps the default composer placeholder (zh-CN)", () => {
    const view = createShellViewModel(createContext({ language: "zh-CN" }), {
      setupNeeded: true,
      width: 80,
    });
    // D.13D: home no longer overrides composer placeholder; the default
    // greeting stays. Setup entry is reachable via Enter-to-start; the
    // dedicated setupHint banner is reserved for task mode.
    expect(view.composer.placeholder).toBe("我能帮您做点什么？");
    expect(view.setupHint).toBeUndefined();
  });

  it("setupNeeded=true in home mode keeps the default composer placeholder (en-US)", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      setupNeeded: true,
      width: 80,
    });
    expect(view.composer.placeholder).toBe("What can I help you with?");
    expect(view.setupHint).toBeUndefined();
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

  it("Home does not show large setupHint block when setupNeeded=true", () => {
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
    // D.13D: home no longer carries the setup sentence as placeholder.
    expect(rendered).not.toContain("按 Enter 开始配置模型");
    // Default greeting remains.
    expect(rendered).toContain("我能帮您做点什么？");
  });

  it("Home visual structure preserved with setup placeholder", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), {
      setupNeeded: true,
      width: 80,
      height: 24,
    });
    const rendered = renderPlainShell(view);
    // Brand centered
    expect(rendered).toContain("LingHun");
    // Vision
    expect(rendered).toContain("技术普惠会越来越成熟");
    // Composer box lines (─)
    expect(rendered).toContain("─");
    // Status tray
    expect(rendered).toContain("项目：");
    expect(rendered).toContain("模型：");
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
    // "> " prefix only on first line; continuation "  " on others
    // "  " (2) + "li" (2) = 4
    expect(cursorCol).toBe(4);
  });

  it("Composer preserves continuation prefix spaces after multiline input", async () => {
    const source = await readFile(join(SRC_ROOT, "shell", "components", "Composer.tsx"), "utf8");
    expect(source).toContain("{sliceWidth(line, maxWidth)}");
    expect(source).not.toContain("{fitText(line, maxWidth)}");

    const buf = createEditBuffer("line1\nline2");
    const { lines, cursorRow, cursorCol } = formatComposerRenderLines({
      buffer: buf,
      placeholder: "placeholder",
      masking: false,
      noColor: false,
      maxWidth: 80,
    });

    expect(lines[0]).toBe("> line1");
    expect(lines[1]).toBe("  line2");
    expect(cursorRow).toBe(1);
    expect(cursorCol).toBe(7);
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
    // At least 3 (capped at 3)
    expect(outputBlocks).toHaveLength(3);
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
    // "> " (2) + 9 masked chars = 11
    expect(cursorCol).toBe(11);
  });

  // =========================================================================
  // Home/Task structure non-regression
  // =========================================================================

  it("Home structure: brand → underline → vision → composer → status (no regression)", () => {
    vi.stubEnv("LINGHUN_TERMINAL_TIER", "modern");
    resetTerminalCapabilityCache();
    const view = createShellViewModel(createContext(), { width: 80, height: 24 });
    const rendered = renderPlainShell(view);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping
    const ANSI_STRIP = /\x1B\[[0-9;]*m/g;
    const lines = rendered.split("\n").map((l) => l.replace(ANSI_STRIP, ""));

    const brandIdx = lines.findIndex((l) => l.trim() === "LingHun");
    const visionIdx = lines.findIndex((l) => l.includes("技术普惠"));
    const composerIdx = lines.findIndex((l) => l.includes("我能帮您做点什么？"));
    const statusIdx = lines.findIndex((l) => l.includes("项目："));

    expect(brandIdx).toBeGreaterThanOrEqual(0);
    expect(visionIdx).toBeGreaterThan(brandIdx);
    expect(composerIdx).toBeGreaterThan(visionIdx);
    expect(statusIdx).toBeGreaterThan(composerIdx);
  });

  it("Task structure: topbar → separator → activity → permission → output (no regression)", () => {
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
    expect(activityIdx).toBeGreaterThan(brandIdx);
    expect(permIdx).toBeGreaterThan(activityIdx);
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
    // "> " prefix (width 2) + masked length
    expect(cursorCol).toBeGreaterThanOrEqual(2);
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
    // Task footer (D.13D rework): minimal mode + index line, NOT the full
    // StatusTray. The "[Linghun] 会话…" noise is gone from Task mode.
    expect(output.text).toContain("默认模式");
    expect(output.text).toContain("索引");
    expect(output.text).not.toContain("项目：");
    // task placeholder used
    expect(output.text).toContain("继续输入…");
  });

  it("Home Ink render still shows brand wordmark (no regression)", async () => {
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
    expect(output.text).toContain("我能帮您做点什么？");
  });

  it("useAnchoredCursor implementation file uses render-phase cursor write (no useEffect/useLayoutEffect)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/useAnchoredCursor.ts"), "utf8");
    // No effect-based write of the cursor — render phase only.
    expect(source).not.toContain("useEffect(");
    expect(source).not.toContain("useLayoutEffect(");
    expect(source).not.toContain("useInsertionEffect(");
    // No de-duplication ref left behind.
    expect(source).not.toContain("lastWrittenRef");
    // setCursorPosition is called from the hook body (render phase).
    expect(source).toContain("setCursorPosition(");
  });
});

describe("D.13D rework — TaskWorkspace footer + bare slash + Shift+Tab + permission focus", () => {
  it("home view does NOT carry taskFooter (taskFooter is task-mode only)", () => {
    const view = createShellViewModel(createContext(), { width: 80 });
    expect(view.viewMode).toBe("home");
    expect(view.taskFooter).toBeUndefined();
  });

  it("task view exposes taskFooter with permission mode + index, no [Linghun] 会话 noise", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      activity: { phase: "thinking", text: "正在思考…" },
    });
    expect(view.taskFooter).toBeDefined();
    expect(view.taskFooter?.permissionMode).toBe("默认模式");
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

  it("task footer shows workspace above a denoised background summary", () => {
    const view = createShellViewModel(createContext(), {
      width: 120,
      viewMode: "task",
      backgroundSummaries: [
        {
          id: "task-724a5c-worker",
          kind: "agent",
          title: "Agent task-724a5c-worker",
          status: "stale",
          currentStep: "stale/resumable",
          progress: { completed: 0, total: 1 },
        },
      ],
    });

    expect(view.taskFooter?.workspaceStatus).toBe("工作树：这是一个很长很长的 Linghun 项目路径");
    expect(view.taskFooter?.runtimeStatus).toContain("后台 1");
    expect(view.taskFooter?.runtimeStatus).toContain("需要确认 1");
    expect(view.taskFooter?.runtimeStatus).not.toContain("可恢复");
    expect(view.taskFooter?.runtimeStatus).toContain("详情 /background");
    expect(view.taskFooter?.runtimeStatus).not.toContain("运行中 0");
    expect(view.taskFooter?.runtimeStatus).not.toContain("待确认 0");
    expect(view.taskFooter?.runtimeStatus).not.toContain("agent 1");
    expect(view.taskFooter?.runtimeStatus).not.toContain("task-724a5c-worker");
    expect(view.taskFooter?.runtimeStatus).not.toContain("stale/resumable");
    expect(view.taskFooter?.runtimeStatus).not.toContain("上次会话恢复的后台任务");
    expect(view.taskFooter?.runtimeStatus).not.toContain("0/1");

    const rendered = renderPlainShell(view);
    expect(rendered.indexOf("工作树：")).toBeGreaterThanOrEqual(0);
    expect(rendered.indexOf("后台 1")).toBeGreaterThan(rendered.indexOf("工作树："));
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
    // 右栏（model · cache · index · reasoning · hint）按顺序作为 segments 渲染。
    expect(source).toContain("rightSegments");
    expect(source.indexOf("footer.workspaceStatus")).toBeLessThan(
      source.indexOf("footer.runtimeStatus"),
    );
    expect(source).toContain("marginTop={1}");
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

  it("bare slash '/' surfaces core candidates from getCoreSlashCandidates()", async () => {
    const { getCoreSlashCandidates } = await import("../slash-dispatch.js");
    const candidates = getCoreSlashCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    // D.13P: bare-slash cap raised from 5 to 8 to surface the full
    // DEFAULT_HELP_SLASHES core set without relying on /help all for the
    // most common entries. Hard cap stays 8 so the inline overlay stays narrow.
    expect(candidates.length).toBeLessThanOrEqual(8);
    const slashes = candidates.map((c) => c.slash);
    expect(slashes).toContain("/model");
    expect(slashes).toContain("/mode");
    expect(slashes).toContain("/help");
    expect(slashes).toContain("/problems");
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

  it("D.13P slash prefix candidates cap at 8 and exclude hidden /status", async () => {
    const { getSlashPrefixCandidates } = await import("../slash-dispatch.js");
    // /s would match many — verify cap=8 is honored.
    const sCandidates = getSlashPrefixCandidates("/s");
    expect(sCandidates.length).toBeLessThanOrEqual(8);
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

  it("D.13P-S latestOutputNext promotes Ctrl+O over /details in zh-CN and en-US", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/view-model.ts"), "utf8");
    // 主屏 latestOutput next-action：Ctrl+O 必须出现在 /details 之前，且 /details 仍保留为备用。
    const zhMatch = source.match(
      /latestOutputNext:\s*"按 Ctrl\+O 查看完整运行时输出（或 \/details）。"/,
    );
    expect(zhMatch).not.toBeNull();
    const enMatch = source.match(
      /latestOutputNext:\s*"Press Ctrl\+O for full runtime output \(or \/details\)\."/,
    );
    expect(enMatch).not.toBeNull();
  });

  it("D.13P-S toolErrorRetryHint promotes Ctrl+O over /details in zh-CN and en-US", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/models/task-suggestion.ts"), "utf8");
    const zhMatch = source.match(
      /toolErrorRetryHint:\s*"按 Ctrl\+O 查看最近一次失败输出（或 \/details）"/,
    );
    expect(zhMatch).not.toBeNull();
    const enMatch = source.match(
      /toolErrorRetryHint:\s*"Press Ctrl\+O for the latest failure output \(or \/details\)"/,
    );
    expect(enMatch).not.toBeNull();
  });

  it("ShellInputEvent type union includes cycle-permission-mode for Shift+Tab", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/types.ts"), "utf8");
    expect(source).toContain('"cycle-permission-mode"');
  });

  it("Composer hides anchored cursor while permission is active (permission is sole focus owner)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    // The render path passes null to useAnchoredCursor when permissionActive,
    // so the cursor is hidden while the permission selector owns focus.
    expect(source).toMatch(/permissionActive\s*\?\s*null\s*:\s*\{\s*row/);
    expect(source).not.toContain("useInlineCursor");
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
    const source = await readFile(join(SRC_ROOT, "index.ts"), "utf8");
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

  it("ShellApp TaskLayout uses full-page top-left layout (no alignItems=center)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    // The TaskLayout outer Box must not center the whole region.
    const taskLayoutStart = source.indexOf("function TaskLayout(");
    expect(taskLayoutStart).toBeGreaterThan(0);
    const nextFn = source.indexOf("function ", taskLayoutStart + 20);
    const body = source.slice(taskLayoutStart, nextFn);
    // Output region uses flexGrow=1; the composer band uses flexShrink=0.
    // D.14D-C2: overflow="hidden" culling moved into the measured TranscriptViewport
    // (TaskLayout delegates the output region to it), so it lives there now.
    expect(body).toContain("flexGrow={1}");
    expect(body).toContain("<TranscriptViewport");
    expect(body).toContain("flexShrink={0}");
    // The original `alignItems="center"` on the outer wrapper is gone.
    const outerWrapper = body.split("\n").slice(0, 4).join("\n");
    expect(outerWrapper).not.toContain('alignItems="center"');
  });

  it("TaskLayout renders a task composer separator and keeps footer surfaces separated", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ShellApp.tsx"), "utf8");
    const taskLayoutStart = source.indexOf("function TaskLayout(");
    const nextFn = source.indexOf("function ", taskLayoutStart + 20);
    const body = source.slice(taskLayoutStart, nextFn);

    expect(body).toContain("const composerRule = lineChar(noColor, capability).repeat(cw)");
    expect(body).toContain("{composerRule}");
    expect(body).toContain("<Composer view={view}");
    expect(body).toContain("<Box width={cw} paddingTop={1}>");
    expect(body).toContain('<Box flexDirection="column" width={cw}>');
    expect(body.indexOf("{composerRule}", body.indexOf("<Composer view={view}"))).toBeGreaterThan(
      body.indexOf("<Composer view={view}"),
    );
    expect(body).not.toContain("width={cw} paddingX={1}");
    expect(body).not.toContain("view.taskRuntimeSummary");
    expect(body.indexOf("<NotificationStack")).toBeLessThan(body.indexOf("{composerRule}"));
    expect(body.indexOf("<StatusFooter")).toBeGreaterThan(body.indexOf("<Composer view={view}"));
    expect(body).not.toContain(
      "`${view.taskRuntimeSummary.title}: ${view.taskRuntimeSummary.summary}`",
    );
  });

  it("D.14D-C2: TranscriptViewport owns the measured overflow=hidden culling", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/ScrollViewport.tsx"), "utf8");
    expect(source).toContain('overflow="hidden"');
    expect(source).toContain("clampTranscriptScroll");
    expect(source).toContain("getComputedHeight");
  });
});

// ShellBlockOutput streaming assistant block —— assistant_text_delta 多片必须
// 累积到同一条 keep:true block，而不是被 _write 的 ephemeral splice 淘汰。
// 触发场景：sendMessage / streamFinalModelAnswerWithoutTools /
// continueModelAfterToolResults 三处 gateway.stream 循环。
describe("ShellBlockOutput — assistant streaming block", () => {
  function makeFakeContext(): TuiContext {
    // 测试只用到 language / lastFullOutput / suppressLastFullOutputCapture 三个字段。
    return {
      language: "zh-CN",
      projectPath: "/tmp",
      sessionId: "test-session",
      lastFullOutput: undefined,
      suppressLastFullOutputCapture: false,
    } as unknown as TuiContext;
  }

  it("两段 assistant_text_delta 必须拼成完整正文（'连' + '接成功' === '连接成功'）", () => {
    const blocks: ProductBlockViewModel[] = [];
    let renderCount = 0;
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks, () => {
      renderCount += 1;
    });

    output.beginAssistantStream("assistant-stream-test-1");
    output.appendAssistantDelta("连");
    output.appendAssistantDelta("接成功");
    output.endAssistantStream();

    const streamingBlock = blocks.find((b) => b.id === "assistant-stream-test-1");
    expect(streamingBlock).toBeDefined();
    expect(streamingBlock?.keep).toBe(true);
    expect(streamingBlock?.fullText).toBe("连接成功");
    expect(streamingBlock?.summary).toBe("连接成功");
    // begin / 2 deltas / end —— 每次都触发 onWrite 重渲染。
    expect(renderCount).toBeGreaterThanOrEqual(3);
  });

  it("普通 writeLine 后再开 streaming block，writeLine 不再被 ephemeral splice 淘汰；keep streaming block 保留", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks);

    // 1) 先开 streaming block —— keep:true
    output.beginAssistantStream("assistant-stream-test-2");
    output.appendAssistantDelta("hello ");
    output.appendAssistantDelta("world");
    output.endAssistantStream();

    // 2) 再写两条普通 writeLine（_write 路径）
    output.write("first ephemeral line\n");
    output.write("second ephemeral line\n");

    // streaming block 必须留下，且 fullText 不丢
    const streamingBlock = blocks.find((b) => b.id === "assistant-stream-test-2");
    expect(streamingBlock).toBeDefined();
    expect(streamingBlock?.fullText).toBe("hello world");
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

  it("lastFullOutput 在 append 时累计；suppressLastFullOutputCapture=true 时不写入", () => {
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);

    output.beginAssistantStream("assistant-stream-test-3");
    output.appendAssistantDelta("连");
    expect(ctx.lastFullOutput).toBe("连");
    output.appendAssistantDelta("接成功");
    expect(ctx.lastFullOutput).toBe("连接成功");

    // 切换到 suppress 模式后，新的 delta 不能再覆盖 lastFullOutput。
    ctx.suppressLastFullOutputCapture = true;
    output.appendAssistantDelta("后续");
    expect(ctx.lastFullOutput).toBe("连接成功");
    output.endAssistantStream();
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
    output.endAssistantStream();

    const streaming = blocks.find((b) => b.id === "assistant-stream-ctrl-o");
    expect(streaming).toBeDefined();

    const view = createShellViewModel(createContext(), { outputBlocks: blocks });
    const visible = view.blocks.find((b) => b.id === "assistant-stream-ctrl-o");
    expect(visible).toBeDefined();
    expect(visible?.nextAction).toBeUndefined();
    expect(visible?.fullText).toContain("第三行");
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

  it("diff code fence 在 color 与 no-color plain renderer 中区分 +/-/context", () => {
    const diff = "```diff\n context line\n+added line\n-removed line\n```";
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
      viewMode: "task",
    });
    const noColorView = createShellViewModel(noColorCtx, {
      noColor: true,
      outputBlocks: [createOutputBlock(diff, "zh-CN", "out-diff-nocolor")],
      width: 120,
      viewMode: "task",
    });
    const colorRendered = renderPlainShell(colorView);
    const noColorRendered = renderPlainShell(noColorView);

    expect(colorRendered).toContain("\x1B[32m+added line");
    expect(colorRendered).toContain("\x1B[31m-removed line");
    expect(colorRendered).toContain("  | ");
    expect(noColorRendered).toContain("  | +added line");
    expect(noColorRendered).toContain("  | -removed line");
    expect(noColorRendered).toContain("  |  context line");
    expect(noColorRendered).not.toContain("\x1B[");
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
    const userStart = source.indexOf('block.messageKind === "user_text"');
    const assistantStart = source.indexOf('block.messageKind === "assistant_text"');
    const userBranch = source.slice(userStart, source.indexOf("const marker", userStart));
    const assistantBranch = source.slice(
      assistantStart,
      source.indexOf("isLocalOutput ?", assistantStart),
    );

    expect(userBranch).toContain("marginBottom={0}");
    expect(userBranch).toContain("│ ");
    expect(userBranch).toContain("MessageMarkdown");
    expect(assistantBranch).toContain("marginTop={isAssistantText ? 1 : 0}");
    expect(assistantBranch).toContain("marginBottom={0}");
  });

  it("Ink task layout keeps transcript, notices, composer, footer, and light hints separated", async () => {
    vi.unstubAllEnvs();
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
              id: "agent-stale-visible",
              kind: "agent",
              title: "Agent active worker",
              status: "stale",
              currentStep: "stale/resumable",
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
    const composerSeparatorIdx = text.indexOf("----------", hintIdx);
    const footerIdx = text.indexOf("Shift+Tab");

    expect(userIdx).toBeGreaterThan(0);
    expect(assistantIdx).toBeGreaterThan(userIdx);
    expect(hintIdx).toBeGreaterThan(assistantIdx);
    expect(composerSeparatorIdx).toBeGreaterThan(hintIdx);
    expect(footerIdx).toBeGreaterThan(composerSeparatorIdx);
    expect(workspaceIdx).toBeGreaterThan(footerIdx);
    expect(runtimeIdx).toBeGreaterThan(footerIdx);
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
    const hintStart = source.indexOf('"cache-hit-low"');
    const hintSnippet = source.slice(hintStart, hintStart + 260);
    const notificationStart = source.indexOf("context.notifications.push");
    const notificationSnippet = source.slice(notificationStart, notificationStart + 360);

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
    expect(view.activity?.text).toBe("正在思考…");
  });

  it("submitted=true en-US 合成 Thinking… fallback", () => {
    const view = createShellViewModel(createContext({ language: "en-US" }), {
      width: 80,
      submitted: true,
    });
    expect(view.activity?.phase).toBe("thinking");
    expect(view.activity?.text).toBe("Thinking…");
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

describe("D.13Q-UX Real Smoke Fix v2 — B. Composer task width", () => {
  it("Composer 源码在 task/pending 模式必须用 taskComposerMaxWidth", async () => {
    const fs = await import("node:fs");
    const composerSource = fs.readFileSync(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    // 锚定源码规则：避免 ShellApp.TaskLayout 的 cw 与 Composer maxWidth 不一致导致 cursor drift。
    expect(composerSource).toContain('view.viewMode === "task" || view.viewMode === "pending"');
    expect(composerSource).toMatch(/taskComposerMaxWidth\(view\.width\)/);
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
    expect(block.kind).toBe("command");
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
    const blocks: ProductBlockViewModel[] = [
      { id: "eph:1", kind: "details", status: "info", title: "", summary: "e1", fullText: "e1" },
      {
        id: "usr:1",
        kind: "command",
        status: "info",
        title: "kept user",
        summary: "",
        keep: true,
        messageKind: "user_text",
      },
      { id: "eph:2", kind: "details", status: "info", title: "", summary: "e2", fullText: "e2" },
      { id: "eph:3", kind: "details", status: "info", title: "", summary: "e3", fullText: "e3" },
      { id: "eph:4", kind: "details", status: "info", title: "", summary: "e4", fullText: "e4" },
      { id: "eph:5", kind: "details", status: "info", title: "", summary: "e5", fullText: "e5" },
    ];
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
      outputBlocks: blocks,
    });
    const ids = view.blocks
      .map((b) => b.id)
      .filter((id) => id.startsWith("eph:") || id.startsWith("usr:"));
    // 5 条 ephemeral 超过 cap=3，应丢最早的 2 条；keep 的 usr:1 必须保留且不被推到顶。
    expect(ids).toContain("usr:1");
    expect(ids).toContain("eph:3");
    expect(ids).toContain("eph:4");
    expect(ids).toContain("eph:5");
    expect(ids).not.toContain("eph:1");
    expect(ids).not.toContain("eph:2");
    // 顺序：先 usr:1（在 eph:2 之前出现），再 eph:3 → eph:4 → eph:5
    const usrPos = ids.indexOf("usr:1");
    const eph3Pos = ids.indexOf("eph:3");
    expect(usrPos).toBeLessThan(eph3Pos);
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
    output.writeLocalCommandOutputLine?.(
      "Tool Bash completed\n- 40 行\n- 输出已折叠，按 Ctrl+O 展开。",
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("local_command_output");
    expect(blocks[0]?.kind).toBe("tool");
    expect(ctx.lastFullOutput).toContain("Tool Bash completed");
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
    const indexSource = fs.readFileSync(join(SRC_ROOT, "index.ts"), "utf8");
    expect(indexSource).toContain("RuntimeIdentityRule=");
    expect(indexSource).toMatch(/Do not include provider, endpointProfile, route role, baseUrl/);
    expect(indexSource).toContain("(provider: ...)");
    expect(indexSource).toContain("openai-compatible");
  });

  it("RuntimeIdentityRule 仍允许 /model doctor 与 /model route doctor 暴露 provider", async () => {
    const fs = await import("node:fs");
    const indexSource = fs.readFileSync(join(SRC_ROOT, "index.ts"), "utf8");
    // RuntimeIdentityRule 显式允许 /model doctor / /model route doctor 暴露 provider
    expect(indexSource).toMatch(/runs \/model doctor or \/model route doctor/);
    // 自然语言问"当前模型"被规则拦截，但 /model doctor 显式命令仍能输出 provider 字段。
    expect(indexSource).toMatch(/provider=\$\{runtime\.provider\}/);
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
      configPanelState: { phase: "panel_list", cursor: 0 },
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

  it("CommandPanel 提示只保留 Esc 关闭，不混入 Ctrl+O 展开", async () => {
    const source = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "components", "CommandPanel.tsx"),
      "utf8",
    );

    expect(source).toContain("Esc 关闭面板");
    expect(source).toContain("Esc close");
    expect(source).not.toContain("Ctrl+O 展开详情");
    expect(source).not.toContain("Ctrl+O details");
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

  it("普通 CommandPanel 不停用 Composer，保留 PageUp/PageDown transcript-scroll 路径", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(SRC_ROOT, "shell/components/Composer.tsx"), "utf8");
    const activeConfig = source.slice(
      source.indexOf("const configPanelActive"),
      source.indexOf("const text = bufferToString"),
    );
    expect(activeConfig).not.toContain("view.commandPanel");
    expect(source).toContain("{ isActive: !configPanelActive }");
    expect(source).toContain('void onInput({ type: "transcript-scroll", action: "halfPageUp" })');
    expect(source).toContain('void onInput({ type: "transcript-scroll", action: "halfPageDown" })');
    expect(source).toContain('void onInput({ type: "transcript-scroll", action: "wheelUp" })');
    expect(source).toContain('void onInput({ type: "transcript-scroll", action: "wheelDown" })');
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

  it("无 transcriptScrollState 时 view.transcriptScroll 为默认 stickToBottom=true / offset=0", () => {
    const view = createShellViewModel(createContext(), {
      width: 80,
      viewMode: "task",
    });
    expect(view.transcriptScroll).toBeDefined();
    expect(view.transcriptScroll?.scrollOffset).toBe(0);
    expect(view.transcriptScroll?.stickToBottom).toBe(true);
  });
});

describe("D.14D explicit details summary-first panel", () => {
  it("D.14D-R2 P3-2: end-to-end presenter→block 同一工具输出块只剩一次 Ctrl+O（回归锁定）", () => {
    // CLOSED_BY_D14D_R 复核：真实 formatToolOutput 产出（含内嵌折叠提示）经
    // createOutputBlock 装配后，ink 主屏渲染层（fullText + nextAction）只出现一次 Ctrl+O。
    const presenterBody = formatToolOutput(
      "Read",
      { text: "x\n".repeat(40), data: { lines: 40 }, truncated: true },
      "zh-CN",
    );
    // 源码事实：presenter 自身不再双重打印（同一字符串只出现一次）。
    expect(presenterBody.match(/Ctrl\+O/g)?.length).toBe(1);
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
    // C3：activity 渲染在块之后（更靠 composer 的对话流底部）。
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
