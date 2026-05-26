import { describe, expect, it } from "vitest";
import type { ProductBlockViewModel, TaskPermissionView } from "../types.js";
import {
  type SuggestionInputs,
  buildTaskSuggestions,
  isKnownSlashCommand,
} from "./task-suggestion.js";

const baseInputs: SuggestionInputs = { language: "zh-CN" };

const permission: TaskPermissionView = {
  toolName: "Bash",
  reason: "需要执行命令",
  risk: "high",
  scope: ["git status"],
  hint: "选择 y / n / d",
};

const failBlock: ProductBlockViewModel = {
  id: "out-fail",
  kind: "error",
  status: "fail",
  title: "Bash 失败",
  summary: "non-zero exit",
};

describe("isKnownSlashCommand", () => {
  it("accepts registered roots", () => {
    expect(isKnownSlashCommand("/help")).toBe(true);
    expect(isKnownSlashCommand("/permissions")).toBe(true);
  });

  it("accepts root + subcommand combinations", () => {
    expect(isKnownSlashCommand("/permissions add allow Bash high")).toBe(true);
    expect(isKnownSlashCommand("/index doctor")).toBe(true);
  });

  it("rejects unknown commands", () => {
    expect(isKnownSlashCommand("/totally-fake")).toBe(false);
    expect(isKnownSlashCommand("not-a-slash")).toBe(false);
  });
});

describe("buildTaskSuggestions", () => {
  it("returns empty when no inputs", () => {
    expect(buildTaskSuggestions(baseInputs)).toEqual([]);
  });

  it("places permission suggestions before tool_error / setup / config / slash", () => {
    const result = buildTaskSuggestions({
      ...baseInputs,
      permission,
      failBlocks: [failBlock],
      setupHint: "未配置模型",
      configHints: [{ id: "model", label: "模型设置", slash: "/model" }],
      slashCandidates: [{ slash: "/help", label: "帮助" }],
    });
    expect(result[0].source).toBe("permission");
    const sources = result.map((s) => s.source);
    const permIdx = sources.indexOf("permission");
    const errIdx = sources.indexOf("tool_error");
    const setIdx = sources.indexOf("setup");
    expect(permIdx).toBeLessThan(errIdx);
    expect(errIdx).toBeLessThan(setIdx);
  });

  it("limits results to max (default 4)", () => {
    const result = buildTaskSuggestions({
      ...baseInputs,
      permission,
      failBlocks: [failBlock],
      setupHint: "未配置模型",
      configHints: [
        { id: "model", label: "模型", slash: "/model" },
        { id: "permissions", label: "权限", slash: "/permissions" },
        { id: "index", label: "索引", slash: "/index status" },
      ],
      slashCandidates: [
        { slash: "/help", label: "帮助" },
        { slash: "/exit", label: "退出" },
      ],
    });
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it("respects custom max", () => {
    const result = buildTaskSuggestions(
      {
        ...baseInputs,
        configHints: [
          { id: "a", label: "A", slash: "/help" },
          { id: "b", label: "B", slash: "/exit" },
        ],
      },
      { max: 1 },
    );
    expect(result).toHaveLength(1);
  });

  it("filters out fake slash actions (whitelist)", () => {
    const result = buildTaskSuggestions({
      ...baseInputs,
      configHints: [
        { id: "fake", label: "Fake", slash: "/totally-fake" },
        { id: "real", label: "Real", slash: "/help" },
      ],
    });
    expect(result.map((s) => s.id)).toEqual(["config:real"]);
  });

  it("includes /permissions only on medium/high risk permission", () => {
    const lowRisk: TaskPermissionView = { ...permission, risk: "low" };
    const lowResult = buildTaskSuggestions({ ...baseInputs, permission: lowRisk });
    expect(lowResult.some((s) => s.id === "permission:rules")).toBe(false);

    const highResult = buildTaskSuggestions({ ...baseInputs, permission });
    expect(highResult.some((s) => s.id === "permission:rules")).toBe(true);
  });

  it("permission details suggestion uses inline action (not slash)", () => {
    const result = buildTaskSuggestions({ ...baseInputs, permission });
    const detailsItem = result.find((s) => s.id === "permission:details");
    expect(detailsItem?.action).toEqual({ kind: "inline", id: "permission_details" });
  });

  it("tool_error suggestion routes to /details", () => {
    const result = buildTaskSuggestions({ ...baseInputs, failBlocks: [failBlock] });
    expect(result[0]).toMatchObject({
      source: "tool_error",
      action: { kind: "slash", command: "/details" },
    });
  });

  it("setup suggestion routes to /model", () => {
    const result = buildTaskSuggestions({ ...baseInputs, setupHint: "未配置模型" });
    expect(result[0]).toMatchObject({
      source: "setup",
      action: { kind: "slash", command: "/model" },
    });
  });

  it("dedupes by id (same slash from multiple sources keeps first)", () => {
    const result = buildTaskSuggestions({
      ...baseInputs,
      configHints: [{ id: "perm", label: "权限", slash: "/permissions" }],
      slashCandidates: [{ slash: "/permissions", label: "Permissions" }],
    });
    const ids = result.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("english labels when language=en-US", () => {
    const result = buildTaskSuggestions({
      ...baseInputs,
      language: "en-US",
      permission,
    });
    expect(result[0].label).toBe("Show permission details");
  });
});
