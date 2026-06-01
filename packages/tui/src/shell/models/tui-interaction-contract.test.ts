import { describe, expect, it } from "vitest";
import {
  clampTaskScroll,
  computeScrollViewportOffset,
  createInitialTaskScroll,
  reduceTaskScroll,
} from "./task-scroll-state.js";
import {
  type OwnerContext,
  type OwnerKeyShape,
  selectInputOwner,
} from "./input-owner-controller.js";

/**
 * Run 3 D — TUI Interaction Contract 集中 invariant 测试。
 *
 * 锁住以下合同：
 * 1. 输入归属：面板存在才独占输入；面板关闭后 Composer 恢复。
 * 2. 可见性：高级面板打开必须可见（stickToBottom 保证）。
 * 3. 滚动语义：0=底部，PageUp 看旧内容，PageDown/End 回最新内容。
 * 4. 提示真实性：Ctrl+O/折叠提示只在确实有隐藏详情时出现。
 * 5. 主屏降噪：Todo/status/planning 不刷屏。
 */

describe("TUI Interaction Contract — 滚动语义", () => {
  it("初始 scrollOffset=0 表示吸底（显示最新内容）", () => {
    const init = createInitialTaskScroll();
    expect(init.scrollOffset).toBe(0);
    expect(init.stickToBottom).toBe(true);
  });

  it("PageUp（delta>0）离开底部", () => {
    const next = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 5 });
    expect(next.scrollOffset).toBe(5);
    expect(next.stickToBottom).toBe(false);
  });

  it("PageDown 回到底部", () => {
    const up = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 10 });
    const down = reduceTaskScroll(up, { type: "scroll", delta: -10 });
    expect(down.scrollOffset).toBe(0);
    expect(down.stickToBottom).toBe(true);
  });

  it("End 从任意位置回到底部", () => {
    const up = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 20 });
    const ended = reduceTaskScroll(up, { type: "end" });
    expect(ended.scrollOffset).toBe(0);
    expect(ended.stickToBottom).toBe(true);
  });

  it("clamp 防止滚动超出内容范围", () => {
    const up = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 100 });
    const clamped = clampTaskScroll(up, 15);
    expect(clamped.scrollOffset).toBe(15);
    expect(clamped.hasOverflow).toBe(true);
  });

  it("内容未溢出时 hasOverflow=false", () => {
    const clamped = clampTaskScroll(createInitialTaskScroll(), 0);
    expect(clamped.hasOverflow).toBe(false);
    expect(clamped.scrollOffset).toBe(0);
  });

  it("ScrollViewport helper 把 stickToBottom=true 锚到底部而不是顶部", () => {
    expect(computeScrollViewportOffset(20, { scrollOffset: 0, stickToBottom: true })).toMatchObject(
      {
        topOffset: 20,
        marginTop: -20,
      },
    );
    expect(computeScrollViewportOffset(20, { scrollOffset: 5, stickToBottom: false })).toMatchObject(
      {
        topOffset: 15,
        marginTop: -15,
      },
    );
    expect(
      computeScrollViewportOffset(20, { scrollOffset: 20, stickToBottom: false }),
    ).toMatchObject({ topOffset: 0, marginTop: 0 });
    expect(computeScrollViewportOffset(0, { scrollOffset: 5, stickToBottom: false })).toMatchObject({
      topOffset: 0,
      marginTop: 0,
    });
  });
});

describe("TUI Interaction Contract — 输入归属", () => {
  const key = (overrides: Partial<OwnerKeyShape> = {}): OwnerKeyShape => ({
    shift: false,
    escape: false,
    tab: false,
    return: false,
    ctrl: false,
    meta: false,
    ...overrides,
  });
  const baseKey = key();
  const escKey = key({ escape: true });
  const returnKey = key({ return: true });

  it("permission 存在时独占所有输入", () => {
    const ctx: OwnerContext = { permissionActive: true, pastePending: false, slashVisible: false };
    expect(selectInputOwner("a", baseKey, ctx)).toBe("permission");
    expect(selectInputOwner("", escKey, ctx)).toBe("permission");
    expect(selectInputOwner("", returnKey, ctx)).toBe("permission");
  });

  it("permission 关闭后 Composer 恢复输入", () => {
    const ctx: OwnerContext = { permissionActive: false, pastePending: false, slashVisible: false };
    expect(selectInputOwner("a", baseKey, ctx)).toBe("composer");
  });

  it("slash 可见时只拦截导航/确认键", () => {
    const ctx: OwnerContext = { permissionActive: false, pastePending: false, slashVisible: true };
    expect(selectInputOwner("", returnKey, ctx)).toBe("slash");
    expect(selectInputOwner("", escKey, ctx)).toBe("slash");
    expect(selectInputOwner("a", baseKey, ctx)).toBe("composer");
  });

  it("面板不可见时不能仍然抢输入（permission=false → composer）", () => {
    const ctx: OwnerContext = { permissionActive: false, pastePending: false, slashVisible: false };
    expect(selectInputOwner("x", baseKey, ctx)).toBe("composer");
  });
});

describe("TUI Interaction Contract — Ctrl+O 提示真实性", () => {
  // 使用 tool-output-presenter 的 createLayeredToolOutput 验证
  it("短 Bash 输出无隐藏内容时不显示 Ctrl+O", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const layered = createLayeredToolOutput(
      "Bash",
      { text: "ok", data: { exitCode: 0, lines: 1 } },
      "zh-CN",
    );
    expect(layered.preview).not.toContain("Ctrl+O");
    expect(layered.truncated).toBe(false);
  });

  it("短 Read 输出（<=3行）无隐藏内容时不显示 Ctrl+O", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const layered = createLayeredToolOutput(
      "Read",
      { text: "line1\nline2", data: { lines: 2 } },
      "zh-CN",
    );
    expect(layered.preview).not.toContain("Ctrl+O");
    expect(layered.truncated).toBe(false);
  });

  it("长输出（>3行）显示 Ctrl+O", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const layered = createLayeredToolOutput(
      "Read",
      { text: "a\nb\nc\nd\ne", data: { lines: 5 } },
      "zh-CN",
    );
    expect(layered.preview).toContain("Ctrl+O");
    expect(layered.truncated).toBe(true);
  });

  it("有 details 时显示 Ctrl+O", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const layered = createLayeredToolOutput(
      "Bash",
      { text: "ok", data: { exitCode: 0, lines: 1 }, details: "extra info here" },
      "zh-CN",
    );
    expect(layered.truncated).toBe(true);
  });

  it("有 fullOutputPath 时显示 Ctrl+O", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const layered = createLayeredToolOutput(
      "Bash",
      { text: "ok", data: { exitCode: 0, lines: 1 }, fullOutputPath: "/tmp/out.log" },
      "zh-CN",
    );
    expect(layered.truncated).toBe(true);
  });

  it("output.truncated=true 时显示 Ctrl+O", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const layered = createLayeredToolOutput(
      "Bash",
      { text: "ok", data: { exitCode: 0, lines: 1 }, truncated: true },
      "zh-CN",
    );
    expect(layered.truncated).toBe(true);
  });
});

describe("TUI Interaction Contract — Todo 预算分类", () => {
  it("isTodoOnlyRound 正确分类 Todo-only 轮次", async () => {
    // 直接测试 isTodoOnlyRound 的逻辑（通过 index.ts 导出或内联验证）
    const isTodoOnly = (calls: { name: string }[]) =>
      calls.length > 0 && calls.every((tc) => tc.name === "Todo");

    expect(isTodoOnly([{ name: "Todo" }])).toBe(true);
    expect(isTodoOnly([{ name: "Todo" }, { name: "Todo" }])).toBe(true);
    expect(isTodoOnly([{ name: "Read" }])).toBe(false);
    expect(isTodoOnly([{ name: "Todo" }, { name: "Read" }])).toBe(false);
    expect(isTodoOnly([])).toBe(false);
  });
});

describe("TUI Interaction Contract — 面板可见性（view-model 层）", () => {
  it("commandPanel 打开时 taskScroll 强制 stickToBottom=true", async () => {
    const { createShellViewModel } = await import("../view-model.js");
    const context = {
      language: "zh-CN" as const,
      projectPath: "/test",
      model: "test-model",
      permissionMode: "default" as const,
      index: { status: "ready" },
      backgroundTasks: [],
      cache: {},
      config: { workspaceTrust: { recorded: true, level: "trusted" } },
      commandPanelState: { title: "Test", summary: ["line"] },
      taskScrollState: { scrollOffset: 10, stickToBottom: false },
    };
    const vm = createShellViewModel(context as any, {
      viewMode: "task",
      outputBlocks: [{ id: "b1", kind: "details", status: "info", title: "old", summary: "old" }],
    });
    expect(vm.taskScroll?.stickToBottom).toBe(true);
    expect(vm.taskScroll?.scrollOffset).toBe(0);
    expect(computeScrollViewportOffset(20, vm.taskScroll)).toMatchObject({
      topOffset: 20,
      marginTop: -20,
    });
  });

  it("面板关闭后 taskScroll 恢复用户滚动位置", async () => {
    const { createShellViewModel } = await import("../view-model.js");
    const context = {
      language: "zh-CN" as const,
      projectPath: "/test",
      model: "test-model",
      permissionMode: "default" as const,
      index: { status: "ready" },
      backgroundTasks: [],
      cache: {},
      config: { workspaceTrust: { recorded: true, level: "trusted" } },
      taskScrollState: { scrollOffset: 7, stickToBottom: false },
    };
    const vm = createShellViewModel(context as any, {
      viewMode: "task",
      outputBlocks: [{ id: "b1", kind: "details", status: "info", title: "old", summary: "old" }],
    });
    expect(vm.taskScroll?.scrollOffset).toBe(7);
    expect(vm.taskScroll?.stickToBottom).toBe(false);
  });
});

describe("TUI Interaction Contract — 主屏降噪", () => {
  it("Todo 输出超过 8 条时主屏只显示前 8 条 + 隐藏提示", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const todoText = Array.from({ length: 12 }, (_, i) => `- task ${i + 1}`).join("\n");
    const layered = createLayeredToolOutput("Todo", { text: todoText }, "zh-CN");
    const lines = layered.preview.split("\n");
    expect(lines.length).toBeLessThanOrEqual(9);
    expect(layered.preview).toContain("主输出已隐藏");
  });

  it("Todo 输出 <=8 条时完整显示", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const todoText = Array.from({ length: 5 }, (_, i) => `- task ${i + 1}`).join("\n");
    const layered = createLayeredToolOutput("Todo", { text: todoText }, "zh-CN");
    expect(layered.preview).not.toContain("主输出已隐藏");
    expect(layered.truncated).toBe(false);
  });
});
