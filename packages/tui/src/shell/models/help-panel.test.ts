import { describe, expect, it } from "vitest";
import { HELP_PANEL_GROUPS, buildHelpPanelData, getHelpPanelEntries } from "./help-panel.js";

describe("help-panel: 分组 + 内容", () => {
  it("HELP_PANEL_GROUPS 顺序为 core → advanced → details", () => {
    expect(HELP_PANEL_GROUPS).toEqual(["core", "advanced", "details"]);
  });

  it("core 分组中文版包含 /help / /model / /permissions", () => {
    const entries = getHelpPanelEntries("core", "zh-CN");
    const slashes = entries.map((e) => e.slash);
    expect(slashes).toContain("/help");
    expect(slashes).toContain("/model");
    expect(slashes).toContain("/permissions");
  });

  it("/status 不在任何分组中（隐藏命令永远过滤）", () => {
    for (const group of HELP_PANEL_GROUPS) {
      for (const lang of ["zh-CN", "en-US"] as const) {
        const slashes = getHelpPanelEntries(group, lang).map((e) => e.slash);
        expect(slashes).not.toContain("/status");
      }
    }
  });

  it("英文版包含与中文版相同数量的核心命令", () => {
    expect(getHelpPanelEntries("core", "zh-CN").length).toBe(
      getHelpPanelEntries("core", "en-US").length,
    );
  });

  it("buildHelpPanelData 把超界 cursor 收敛到合法范围", () => {
    const data = buildHelpPanelData("core", 999, "zh-CN");
    expect(data.cursor).toBeLessThan(data.entries.length);
  });

  it("buildHelpPanelData 把负 cursor 收敛到 0", () => {
    const data = buildHelpPanelData("advanced", -5, "zh-CN");
    expect(data.cursor).toBe(0);
  });

  it("details 分组包含 /details / /model doctor", () => {
    const entries = getHelpPanelEntries("details", "zh-CN");
    const slashes = entries.map((e) => e.slash);
    expect(slashes).toContain("/details");
    expect(slashes).toContain("/model doctor");
  });

  it("core help panel is short and does not surface debug/schema/gate internals", () => {
    for (const lang of ["zh-CN", "en-US"] as const) {
      const data = buildHelpPanelData("core", 0, lang);
      const main = data.entries.map((entry) => `${entry.slash} ${entry.description}`).join("\n");

      expect(data.entries.length).toBeLessThanOrEqual(8);
      expect(main).not.toMatch(/schema|debug|sourceRef|gate retry|checkpoint id|log path/iu);
      expect(data.entries.some((entry) => entry.slash === "/details")).toBe(true);
    }
  });
});
