import { describe, expect, it } from "vitest";
import {
  type ConfigState,
  findConfigPanel,
  getActionLabel,
  getConfigPanels,
  getPanelText,
  reduceConfigState,
} from "./config-control-plane.js";
import { isKnownSlashCommand } from "./task-suggestion.js";

const idle: ConfigState = { phase: "idle" };

describe("ConfigControlPlane data", () => {
  it("exposes 14 panels in stable order", () => {
    const panels = getConfigPanels();
    expect(panels.map((p) => p.id)).toEqual([
      "model",
      "language",
      "permissions",
      "memory",
      "index",
      "mcp",
      "cache",
      "background",
      "remote",
      "hooks",
      "plugins",
      "skills",
      "workflows",
      "trust",
    ]);
  });

  it("every action.slash is on the SLASH_COMMAND_REGISTRY whitelist", () => {
    for (const panel of getConfigPanels()) {
      for (const action of panel.actions) {
        expect(isKnownSlashCommand(action.slash)).toBe(true);
      }
    }
  });

  it("findConfigPanel returns the panel by id", () => {
    expect(findConfigPanel("index")?.titleZh).toBe("索引");
    expect(findConfigPanel("hooks")?.rootSlash).toBe("/doctor");
  });

  it("getPanelText returns localized title/summary", () => {
    const panel = findConfigPanel("model");
    if (!panel) throw new Error("missing model panel");
    expect(getPanelText(panel, "zh-CN").title).toBe("模型");
    expect(getPanelText(panel, "en-US").title).toBe("Model");
  });

  it("getActionLabel respects language", () => {
    const panel = findConfigPanel("index");
    if (!panel) throw new Error("missing index panel");
    const status = panel.actions.find((a) => a.id === "status");
    if (!status) throw new Error("missing index status action");
    expect(getActionLabel(status, "zh-CN")).toBe("状态");
    expect(getActionLabel(status, "en-US")).toBe("Status");
  });
});

describe("reduceConfigState", () => {
  it("open from idle goes to panel_list cursor 0", () => {
    const step = reduceConfigState(idle, { type: "open" });
    expect(step.next).toEqual({ phase: "panel_list", cursor: 0 });
    expect(step.dispatch).toEqual({ kind: "none" });
  });

  it("open is a no-op when not idle", () => {
    const start: ConfigState = { phase: "panel_list", cursor: 3 };
    const step = reduceConfigState(start, { type: "open" });
    expect(step.next).toBe(start);
  });

  it("move clamps within panel_list bounds", () => {
    const total = getConfigPanels().length;
    const stepUp = reduceConfigState(
      { phase: "panel_list", cursor: 0 },
      { type: "move", delta: -1 },
    );
    expect(stepUp.next).toEqual({ phase: "panel_list", cursor: 0 });
    const stepDown = reduceConfigState(
      { phase: "panel_list", cursor: total - 1 },
      { type: "move", delta: 1 },
    );
    expect(stepDown.next).toEqual({ phase: "panel_list", cursor: total - 1 });
  });

  it("enter from panel_list opens panel_detail with actionCursor 0", () => {
    const step = reduceConfigState(
      { phase: "panel_list", cursor: 4 }, // index panel
      { type: "enter" },
    );
    expect(step.next).toEqual({ phase: "panel_detail", panelId: "index", actionCursor: 0 });
    expect(step.dispatch).toEqual({ kind: "none" });
  });

  it("enter from panel_detail dispatches the current action slash", () => {
    const step = reduceConfigState(
      { phase: "panel_detail", panelId: "index", actionCursor: 1 },
      { type: "enter" },
    );
    expect(step.dispatch).toEqual({ kind: "slash", command: "/index doctor" });
  });

  it("enter on a panel with one action dispatches that single slash", () => {
    const step = reduceConfigState(
      { phase: "panel_detail", panelId: "model", actionCursor: 0 },
      { type: "enter" },
    );
    expect(step.dispatch).toEqual({ kind: "slash", command: "/model" });
  });

  it("language panel dispatches explicit switch commands instead of bare /language", () => {
    const panel = findConfigPanel("language");
    expect(panel?.actions.map((action) => action.slash)).toEqual([
      "/language zh-CN",
      "/language en-US",
    ]);
    const step = reduceConfigState(
      { phase: "panel_detail", panelId: "language", actionCursor: 1 },
      { type: "enter" },
    );
    expect(step.dispatch).toEqual({ kind: "slash", command: "/language en-US" });
  });

  it("move clamps within panel_detail action bounds", () => {
    const step = reduceConfigState(
      { phase: "panel_detail", panelId: "model", actionCursor: 0 },
      { type: "move", delta: 1 },
    );
    // model panel only has 1 action → cursor stays at 0
    expect(step.next).toEqual({ phase: "panel_detail", panelId: "model", actionCursor: 0 });
  });

  it("back from panel_detail returns to panel_list with cursor on origin panel", () => {
    const step = reduceConfigState(
      { phase: "panel_detail", panelId: "cache", actionCursor: 1 },
      { type: "back" },
    );
    expect(step.next).toEqual({
      phase: "panel_list",
      cursor: getConfigPanels().findIndex((p) => p.id === "cache"),
    });
  });

  it("back from panel_list returns to idle", () => {
    const step = reduceConfigState({ phase: "panel_list", cursor: 2 }, { type: "back" });
    expect(step.next).toEqual({ phase: "idle" });
  });

  it("close always returns to idle", () => {
    const step = reduceConfigState(
      { phase: "panel_detail", panelId: "trust", actionCursor: 0 },
      { type: "close" },
    );
    expect(step.next).toEqual({ phase: "idle" });
  });
});
