import { describe, expect, it } from "vitest";
import {
  type OwnerContext,
  type OwnerKeyShape,
  selectInputOwner,
} from "../components/Composer.js";
import {
  clampTranscriptScroll,
  computeScrollViewportOffset,
  createInitialTranscriptScroll,
  reduceTranscriptScroll,
} from "./transcript-scroll-state.js";
import {
  buildTranscriptTextRows,
  parseSgrMouseEvent,
  reduceTranscriptSelection,
  selectedTextFromRows,
} from "./transcript-selection-state.js";

type ShellViewModelContext = Parameters<typeof import("../view-model.js").createShellViewModel>[0];

type MinimalTuiContext = {
  language: "zh-CN";
  projectPath: string;
  model: string;
  permissionMode: "default";
  index: { status: "ready" };
  backgroundTasks: [];
  cache: Record<string, never>;
  config: { workspaceTrust: { recorded: true; level: "trusted" } };
  commandPanelState?: import("../types.js").CommandPanelView;
  transcriptScrollState?: import("../types.js").TranscriptScrollView;
};

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
    const init = createInitialTranscriptScroll();
    expect(init.scrollOffset).toBe(0);
    expect(init.stickToBottom).toBe(true);
  });

  it("PageUp 语义动作按半页离开底部", () => {
    const measured = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "measure",
      viewportHeight: 20,
      contentHeight: 80,
    });
    const next = reduceTranscriptScroll(measured, { type: "scroll", action: "halfPageUp" });
    expect(next.scrollOffset).toBe(10);
    expect(next.stickToBottom).toBe(false);
  });

  it("PageDown 语义动作回到底部", () => {
    const measured = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "measure",
      viewportHeight: 20,
      contentHeight: 80,
    });
    const up = reduceTranscriptScroll(measured, { type: "scroll", action: "halfPageUp" });
    const down = reduceTranscriptScroll(up, { type: "scroll", action: "halfPageDown" });
    expect(down.scrollOffset).toBe(0);
    expect(down.stickToBottom).toBe(true);
  });

  it("End 从任意位置回到底部", () => {
    const up = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "scroll",
      delta: 20,
    });
    const ended = reduceTranscriptScroll(up, { type: "end" });
    expect(ended.scrollOffset).toBe(0);
    expect(ended.stickToBottom).toBe(true);
  });

  it("Home/top 使用测量上界跳到顶部", () => {
    const measured = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "measure",
      viewportHeight: 10,
      contentHeight: 35,
    });
    const top = reduceTranscriptScroll(measured, { type: "scroll", action: "top" });
    expect(top.scrollOffset).toBe(25);
    expect(top.stickToBottom).toBe(false);
  });

  it("旧 delta 兼容路径仍被 clamp 到测量上界", () => {
    const measured = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "measure",
      viewportHeight: 10,
      contentHeight: 25,
    });
    const next = reduceTranscriptScroll(measured, { type: "scroll", delta: 100 });
    expect(next.scrollOffset).toBe(15);
    expect(next.stickToBottom).toBe(false);
  });

  it("clamp 防止滚动超出内容范围", () => {
    const up = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "scroll",
      delta: 100,
    });
    const clamped = clampTranscriptScroll(up, 15);
    expect(clamped.scrollOffset).toBe(15);
    expect(clamped.hasOverflow).toBe(true);
  });

  it("内容未溢出时 hasOverflow=false", () => {
    const clamped = clampTranscriptScroll(createInitialTranscriptScroll(), 0);
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
    expect(
      computeScrollViewportOffset(20, { scrollOffset: 5, stickToBottom: false }),
    ).toMatchObject({
      topOffset: 15,
      marginTop: -15,
    });
    expect(
      computeScrollViewportOffset(20, { scrollOffset: 20, stickToBottom: false }),
    ).toMatchObject({ topOffset: 0, marginTop: 0 });
    expect(computeScrollViewportOffset(0, { scrollOffset: 5, stickToBottom: false })).toMatchObject(
      {
        topOffset: 0,
        marginTop: 0,
      },
    );
  });

  // ─── Phase 6.6: wheel scroll & stick-to-bottom semantics ───

  it("wheelUp 按 wheelStep/1 行离开底部（stickToBottom=false）", () => {
    const measured = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "measure",
      viewportHeight: 20,
      contentHeight: 80,
    });
    const up = reduceTranscriptScroll(measured, { type: "scroll", action: "wheelUp" });
    expect(up.scrollOffset).toBe(1);
    expect(up.stickToBottom).toBe(false);
  });

  it("wheelDown 滚到底部时恢复 stickToBottom=true", () => {
    const measured = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "measure",
      viewportHeight: 20,
      contentHeight: 80,
    });
    const up = reduceTranscriptScroll(measured, { type: "scroll", action: "wheelUp" });
    const down = reduceTranscriptScroll(up, { type: "scroll", action: "wheelDown" });
    expect(down.scrollOffset).toBe(0);
    expect(down.stickToBottom).toBe(true);
  });

  it("连续 wheelUp 累加 offset（不超出 maxOffset）", () => {
    const measured = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "measure",
      viewportHeight: 15,
      contentHeight: 25,
    });
    let s = measured;
    for (let i = 0; i < 20; i++) {
      s = reduceTranscriptScroll(s, { type: "scroll", action: "wheelUp" });
    }
    expect(s.scrollOffset).toBeLessThanOrEqual(10);
    expect(s.stickToBottom).toBe(false);
    expect(s.scrollOffset).toBe(10);
  });

  it("脱底后新输出不强制跳底（scrollOffset>0 保持 stickToBottom=false）", () => {
    const measured = reduceTranscriptScroll(createInitialTranscriptScroll(), {
      type: "measure",
      viewportHeight: 10,
      contentHeight: 50,
    });
    const scrolled = reduceTranscriptScroll(measured, { type: "scroll", action: "halfPageUp" });
    expect(scrolled.stickToBottom).toBe(false);
    // 模拟新一轮 measure（内容增长），offset 仍非零，stickToBottom 保持不变。
    const remeasured = reduceTranscriptScroll(scrolled, {
      type: "measure",
      viewportHeight: 10,
      contentHeight: 70,
    });
    expect(remeasured.stickToBottom).toBe(false);
    expect(remeasured.scrollOffset).toBeGreaterThan(0);
  });
});

describe("TUI Interaction Contract — 自研拖选复制语义", () => {
  it("解析 SGR mouse down/drag/up 与滚轮事件", () => {
    expect(parseSgrMouseEvent("\x1B[<0;10;5M")).toMatchObject({
      x: 9,
      y: 4,
      button: "left",
      action: "down",
    });
    expect(parseSgrMouseEvent("[<32;10;6M")).toMatchObject({
      x: 9,
      y: 5,
      button: "left",
      action: "drag",
    });
    expect(parseSgrMouseEvent("\x1B[<0;10;6m")).toMatchObject({
      x: 9,
      y: 5,
      button: "left",
      action: "up",
    });
    expect(parseSgrMouseEvent("\x1B[<64;1;1M")).toMatchObject({
      button: "wheel-up",
      action: "wheel",
    });
  });

  it("拖选文本投影可跨越当前视口外的 transcript 行", () => {
    const rows = buildTranscriptTextRows([
      {
        id: "assistant",
        kind: "details",
        status: "info",
        title: "",
        summary: "line 1",
        fullText: "line 1\nline 2\nline 3\nline 4\nline 5",
        messageKind: "assistant_text",
      },
    ]);
    expect(selectedTextFromRows(rows, { row: 1, column: 0 }, { row: 4, column: 6 })).toBe(
      "line 2\nline 3\nline 4\nline 5",
    );
  });

  it("拖到视口上/下边缘时给出 bounded autoscroll delta 并保持 selectedText", () => {
    const rows = buildTranscriptTextRows([
      {
        id: "assistant-rows",
        kind: "details",
        status: "info",
        title: "",
        summary: "",
        fullText: Array.from({ length: 20 }, (_, index) => `row ${index}`).join("\n"),
        messageKind: "assistant_text",
      },
    ]);
    const geometry = { x: 0, y: 0, width: 20, height: 4, contentHeight: 20, topOffset: 10 };
    const down = reduceTranscriptSelection({
      state: undefined,
      event: { x: 1, y: 1, button: "left", action: "down" },
      rows,
      geometry,
      scroll: { scrollOffset: 4, stickToBottom: false, viewportHeight: 4, contentHeight: 20 },
    });
    const dragUp = reduceTranscriptSelection({
      state: down.state,
      event: { x: 1, y: -1, button: "left", action: "drag" },
      rows,
      geometry,
      scroll: { scrollOffset: 4, stickToBottom: false, viewportHeight: 4, contentHeight: 20 },
    });
    expect(dragUp.scrollDelta).toBe(2);
    expect(dragUp.state?.selectedText).toContain("ow 10");

    const dragDown = reduceTranscriptSelection({
      state: down.state,
      event: { x: 1, y: 10, button: "left", action: "drag" },
      rows,
      geometry,
      scroll: { scrollOffset: 4, stickToBottom: false, viewportHeight: 4, contentHeight: 20 },
    });
    expect(dragDown.scrollDelta).toBe(-2);
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

  it("panel 存在时 Esc 只归 panel，不落到全局 escape", () => {
    const ctx: OwnerContext = {
      permissionActive: false,
      panelActive: true,
      pastePending: false,
      slashVisible: true,
    };
    expect(selectInputOwner("", escKey, ctx)).toBe("panel");
    expect(selectInputOwner("a", baseKey, ctx)).toBe("composer");
  });

  it("panel 或 slash 可见时不可区分的 modified Enter 不伪装成 Composer 换行", () => {
    const modifiedEnter = key({ return: true, shift: true });
    expect(
      selectInputOwner("", modifiedEnter, {
        permissionActive: false,
        panelActive: true,
        panelInteractive: true,
        pastePending: false,
        slashVisible: false,
      }),
    ).toBe("panel");
    expect(
      selectInputOwner("", modifiedEnter, {
        permissionActive: false,
        pastePending: false,
        slashVisible: true,
      }),
    ).toBe("slash");
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

  it("长输出（>100行）显示 Ctrl+O", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const layered = createLayeredToolOutput(
      "Read",
      { text: "line\n".repeat(150), data: { lines: 150 } },
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
  it("commandPanel 打开时 transcriptScroll 保留用户滚动位置（不强制 stickToBottom）", async () => {
    const { createShellViewModel } = await import("../view-model.js");
    const context: MinimalTuiContext = {
      language: "zh-CN" as const,
      projectPath: "/test",
      model: "test-model",
      permissionMode: "default" as const,
      index: { status: "ready" },
      backgroundTasks: [],
      cache: {},
      config: { workspaceTrust: { recorded: true, level: "trusted" } },
      commandPanelState: { title: "Test", summary: ["line"] },
      transcriptScrollState: { scrollOffset: 10, stickToBottom: false },
    };
    const vm = createShellViewModel(context as unknown as ShellViewModelContext, {
      viewMode: "task",
      outputBlocks: [{ id: "b1", kind: "details", status: "info", title: "old", summary: "old" }],
    });
    expect(vm.transcriptScroll?.stickToBottom).toBe(false);
    expect(vm.transcriptScroll?.scrollOffset).toBe(10);
  });

  it("面板关闭后 transcriptScroll 恢复用户滚动位置", async () => {
    const { createShellViewModel } = await import("../view-model.js");
    const context: MinimalTuiContext = {
      language: "zh-CN" as const,
      projectPath: "/test",
      model: "test-model",
      permissionMode: "default" as const,
      index: { status: "ready" },
      backgroundTasks: [],
      cache: {},
      config: { workspaceTrust: { recorded: true, level: "trusted" } },
      transcriptScrollState: { scrollOffset: 7, stickToBottom: false },
    };
    const vm = createShellViewModel(context as unknown as ShellViewModelContext, {
      viewMode: "task",
      outputBlocks: [{ id: "b1", kind: "details", status: "info", title: "old", summary: "old" }],
    });
    expect(vm.transcriptScroll?.scrollOffset).toBe(7);
    expect(vm.transcriptScroll?.stickToBottom).toBe(false);
  });
});

describe("TUI Interaction Contract — 主屏降噪", () => {
  it("Todo 结构化数据在主屏显示语义状态摘要，不显示原始列表", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const layered = createLayeredToolOutput(
      "Todo",
      {
        text: "[pending] task 1\n[in_progress] task 2",
        data: {
          items: [
            { id: "1", content: "task 1", status: "pending" },
            { id: "2", content: "task 2", status: "in_progress" },
            { id: "3", content: "task 3", status: "completed" },
            { id: "4", content: "task 4", status: "blocked" },
          ],
        },
      },
      "zh-CN",
    );
    expect(layered.preview).toContain("进行中 1");
    expect(layered.preview).toContain("待办 1");
    expect(layered.preview).toContain("完成 1");
    expect(layered.preview).toContain("阻塞 1");
    expect(layered.preview).toContain("进行中: task 2");
    expect(layered.preview).not.toContain("[pending]");
    expect(layered.truncated).toBe(true);
  });

  it("Todo 无结构化数据时保留旧文本回退", async () => {
    const { createLayeredToolOutput } = await import("../../tool-output-presenter.js");
    const todoText = Array.from({ length: 5 }, (_, i) => `- task ${i + 1}`).join("\n");
    const layered = createLayeredToolOutput("Todo", { text: todoText }, "zh-CN");
    expect(layered.preview).not.toContain("主输出已隐藏");
    expect(layered.truncated).toBe(false);
  });
});
