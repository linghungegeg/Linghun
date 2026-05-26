import { describe, expect, it } from "vitest";
import type { PermissionRule } from "../../permission-continuation-runtime.js";
import {
  type ElevationInput,
  buildElevationOptions,
  hasExistingAllowRule,
} from "./permission-elevation.js";

const baseInput: ElevationInput = {
  toolName: "Bash",
  scope: ["git status"],
  risk: "medium",
  existingRules: [],
  language: "zh-CN",
};

describe("PermissionElevationModel", () => {
  it("returns 4 options when no allow rule exists (zh-CN)", () => {
    const opts = buildElevationOptions(baseInput);
    expect(opts.map((o) => o.id)).toEqual(["allow_once", "allow_always_tool", "deny", "details"]);
    expect(opts[0].shortcut).toBe("y");
    expect(opts[1].shortcut).toBe("a");
    expect(opts[2].shortcut).toBe("n");
    expect(opts[3].shortcut).toBe("d");
  });

  it("hides allow_always_tool when an allow rule already covers the tool", () => {
    const rules: PermissionRule[] = [{ id: "r1", effect: "allow", toolName: "Bash" }];
    const opts = buildElevationOptions({ ...baseInput, existingRules: rules });
    expect(opts.map((o) => o.id)).toEqual(["allow_once", "deny", "details"]);
  });

  it("treats wildcard '*' as covering any tool", () => {
    const rules: PermissionRule[] = [{ id: "r1", effect: "allow", toolName: "*" }];
    const opts = buildElevationOptions({ ...baseInput, existingRules: rules });
    expect(opts.map((o) => o.id)).not.toContain("allow_always_tool");
  });

  it("does not treat allow rule with mismatched risk as covering", () => {
    const rules: PermissionRule[] = [{ id: "r1", effect: "allow", toolName: "Bash", risk: "low" }];
    // current risk = medium → 'low' allow rule does not cover medium request
    const opts = buildElevationOptions({ ...baseInput, existingRules: rules, risk: "medium" });
    expect(opts.map((o) => o.id)).toContain("allow_always_tool");
  });

  it("does not treat ask/deny rules as covering allow", () => {
    const rules: PermissionRule[] = [
      { id: "r1", effect: "ask", toolName: "Bash" },
      { id: "r2", effect: "deny", toolName: "Bash" },
    ];
    const opts = buildElevationOptions({ ...baseInput, existingRules: rules });
    expect(opts.map((o) => o.id)).toContain("allow_always_tool");
  });

  it("dispatches submit yes + /permissions add allow <tool> <risk> for allow_always_tool", () => {
    const opts = buildElevationOptions({ ...baseInput, risk: "high" });
    const always = opts.find((o) => o.id === "allow_always_tool");
    // 复合动作契约：先放行当前 pending（submit yes），再持久化规则（slash）。
    expect(always?.dispatches).toEqual([
      { kind: "submit", text: "yes" },
      { kind: "slash", command: "/permissions add allow Bash high" },
    ]);
    // 顺序敏感：第 0 项必须是 submit yes，第 1 项必须是 slash persist。
    expect(always?.dispatches[0]).toEqual({ kind: "submit", text: "yes" });
    expect(always?.dispatches[1]).toEqual({
      kind: "slash",
      command: "/permissions add allow Bash high",
    });
  });

  it("uses high-risk wording for allow_always hint when risk = high", () => {
    const opts = buildElevationOptions({ ...baseInput, risk: "high" });
    const always = opts.find((o) => o.id === "allow_always_tool");
    expect(always?.hint).toMatch(/高风险|HIGH risk/);
  });

  it("uses english labels when language=en-US", () => {
    const opts = buildElevationOptions({ ...baseInput, language: "en-US" });
    const labels = opts.map((o) => o.label);
    expect(labels).toContain("Allow once");
    expect(labels).toContain("Always allow this tool");
    expect(labels).toContain("Deny");
    expect(labels).toContain("Details");
  });

  it("hasExistingAllowRule returns false on empty rules", () => {
    expect(hasExistingAllowRule([], "Bash", "medium")).toBe(false);
  });

  it("hasExistingAllowRule respects effect type", () => {
    expect(
      hasExistingAllowRule([{ id: "r", effect: "deny", toolName: "Bash" }], "Bash", "medium"),
    ).toBe(false);
    expect(
      hasExistingAllowRule([{ id: "r", effect: "allow", toolName: "Bash" }], "Bash", "medium"),
    ).toBe(true);
  });

  it("allow_once dispatches submit yes; deny dispatches submit no", () => {
    const opts = buildElevationOptions(baseInput);
    expect(opts.find((o) => o.id === "allow_once")?.dispatches).toEqual([
      { kind: "submit", text: "yes" },
    ]);
    expect(opts.find((o) => o.id === "deny")?.dispatches).toEqual([{ kind: "submit", text: "no" }]);
  });

  it("details has empty dispatches array (inline expansion only)", () => {
    const opts = buildElevationOptions(baseInput);
    expect(opts.find((o) => o.id === "details")?.dispatches).toEqual([]);
  });
});
