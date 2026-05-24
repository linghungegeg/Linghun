import { describe, expect, it, vi } from "vitest";
import type { TuiContext } from "../index.js";
import { shouldUseInkShell } from "./ink-renderer.js";
import { renderPlainShell } from "./plain-renderer.js";
import { createOutputBlock, createShellViewModel, getComposerPlaceholder } from "./view-model.js";

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
  it("uses the required zh-CN and en-US home slogan and composer placeholders", () => {
    const zhView = createShellViewModel(createContext({ language: "zh-CN" }), { width: 80 });
    const enView = createShellViewModel(createContext({ language: "en-US" }), { width: 80 });

    expect(zhView.homeSummary).toContain("技术普惠会越来越成熟，而你就是最伟大的梦想家。");
    expect(enView.homeSummary).toContain(
      "Technology will become more accessible, and you are the greatest dreamer.",
    );
    expect(getComposerPlaceholder("zh-CN")).toBe("我能帮您做点什么？");
    expect(getComposerPlaceholder("en-US")).toBe("What can I help you with?");
    expect(zhView.composer.placeholder).toBe("我能帮您做点什么？");
    expect(enView.composer.placeholder).toBe("What can I help you with?");
  });

  it("projects setup-needed state with natural-language primary path before /model setup", () => {
    const zhView = createShellViewModel(createContext(), { setupNeeded: true, width: 120 });
    const enView = createShellViewModel(createContext({ language: "en-US" }), {
      setupNeeded: true,
      width: 120,
    });
    const setupBlock = zhView.blocks.find((block) => block.id === "setup-needed");
    const enSetupBlock = enView.blocks.find((block) => block.id === "setup-needed");

    expect(zhView.homeTitle).toBe("Linghun 编程终端");
    expect(zhView.status.mode).toBe("风险确认");
    expect(zhView.status.trust).toBe("已信任");
    expect(zhView.status.index).toBe("索引 ready");
    expect(zhView.status.cache).toBe("缓存 42%");
    expect(zhView.status.background).toBe("后台 1");
    expect(setupBlock?.status).toBe("blocked");
    expect(setupBlock?.summary).toContain("不是当前仓库配置");
    expect(setupBlock?.nextAction).toContain("按 Enter");
    expect(setupBlock?.nextAction).toContain("我要配置模型");
    expect(setupBlock?.nextAction).toContain("高级/恢复：/model setup");
    expect(enSetupBlock?.nextAction).toContain("press Enter");
    expect(enSetupBlock?.nextAction).toContain("configure provider");
    expect(enSetupBlock?.nextAction).toContain("advanced/recovery: /model setup");
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

  it("keeps 120/80/60/40-column view models stable for long CJK paths and model names", () => {
    for (const width of [120, 80, 60, 40]) {
      const view = createShellViewModel(createContext(), { width });

      expect(view.width).toBe(width);
      expect(view.projectName.length).toBeLessThanOrEqual(width);
      expect(view.status.model.length).toBeLessThanOrEqual(width <= 40 ? 15 : 25);
      expect(view.blocks.map((block) => block.id)).toEqual(["home", "repo-state"]);
      expect(view.blocks[0]?.summary).toContain("模型");
      for (const block of view.blocks) {
        expect(block.title.length).toBeLessThanOrEqual(width);
        expect(block.summary.length).toBeLessThanOrEqual(width);
      }
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
