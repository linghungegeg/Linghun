import { describe, expect, it, vi } from "vitest";
import type { TuiContext } from "../index.js";
import { shouldUseInkShell } from "./ink-renderer.js";
import { renderPlainShell } from "./plain-renderer.js";
import { createShellViewModel, getComposerPlaceholder } from "./view-model.js";

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
  it("uses the required zh-CN and en-US composer placeholders", () => {
    expect(getComposerPlaceholder("zh-CN")).toBe("我能帮您做点什么？");
    expect(getComposerPlaceholder("en-US")).toBe("What can I help you with?");
  });

  it("projects setup-needed state into a product block", () => {
    const view = createShellViewModel(createContext(), { setupNeeded: true, width: 80 });

    expect(view.homeTitle).toBe("Linghun 编程终端");
    expect(view.status.mode).toBe("风险确认");
    expect(view.status.trust).toBe("已信任");
    expect(view.status.index).toBe("索引 ready");
    expect(view.status.cache).toBe("缓存 42%");
    expect(view.status.background).toBe("后台 1");
    expect(
      view.blocks.some((block) => block.id === "setup-needed" && block.status === "blocked"),
    ).toBe(true);
  });

  it("keeps narrow 80/60/40-column view models bounded for long CJK paths and model names", () => {
    for (const width of [80, 60, 40]) {
      const view = createShellViewModel(createContext(), { width });

      expect(view.width).toBe(width);
      expect(view.projectName.length).toBeLessThanOrEqual(width);
      expect(view.status.model.length).toBeLessThanOrEqual(width <= 40 ? 15 : 25);
      expect(view.blocks[0]?.summary).toContain("模型");
    }
  });

  it("renders no-color plain fallback with text markers and no internal setup terms", () => {
    const view = createShellViewModel(createContext(), {
      noColor: true,
      setupNeeded: true,
      width: 40,
      limitations: ["当前为无颜色模式。"],
    });
    const rendered = renderPlainShell(view);

    expect(rendered).toContain("[INFO] 首页");
    expect(rendered).toContain("[BLOCKED] 需要配置模型");
    expect(rendered).toContain("我能帮您做点什么？");
    expect(rendered).toContain("当前为无颜色模式。");
    expect(rendered).not.toContain("Start Gate");
    expect(rendered).not.toContain("endpointProfile");
    expect(rendered).not.toContain("tool_result");
    expect(rendered).not.toContain("local/static only");
  });
});

describe("Ink shell selection", () => {
  it("keeps non-TTY, dumb terminal, and plain opt-in on fallback", () => {
    vi.unstubAllEnvs();
    const input = { isTTY: true } as NodeJS.ReadStream;
    const output = { isTTY: true } as NodeJS.WriteStream;

    expect(shouldUseInkShell({ isTTY: false } as NodeJS.ReadStream, output)).toBe(false);
    expect(shouldUseInkShell(input, { isTTY: false } as NodeJS.WriteStream)).toBe(false);

    vi.stubEnv("TERM", "dumb");
    expect(shouldUseInkShell(input, output)).toBe(false);
    vi.unstubAllEnvs();

    vi.stubEnv("LINGHUN_TUI_PLAIN", "1");
    expect(shouldUseInkShell(input, output)).toBe(false);
  });

  it("allows TTY Ink shell while NO_COLOR stays a render-mode concern", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TERM", "xterm-256color");
    vi.stubEnv("NO_COLOR", "1");

    expect(
      shouldUseInkShell(
        { isTTY: true } as NodeJS.ReadStream,
        { isTTY: true } as NodeJS.WriteStream,
      ),
    ).toBe(true);
  });
});
