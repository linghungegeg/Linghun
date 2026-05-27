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

  it("does not surface permission entries when permission is active (D.13L Block E)", () => {
    const result = buildTaskSuggestions({
      ...baseInputs,
      permission,
      failBlocks: [failBlock],
      setupHint: "未配置模型",
      configHints: [{ id: "model", label: "模型设置", slash: "/model" }],
      slashCandidates: [{ slash: "/help", label: "帮助" }],
    });
    // 权限卡现在在 PermissionControl 主屏自带 [是 / 始终允许 / 否]，
    // suggestion bar 不再代为出 permission:details / permission:rules。
    expect(result.some((s) => s.source === "permission")).toBe(false);
    // 非 permission 来源仍按 tool_error > setup > config > slash 排序。
    const sources = result.map((s) => s.source);
    const errIdx = sources.indexOf("tool_error");
    const setIdx = sources.indexOf("setup");
    expect(errIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(errIdx);
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

  it("never emits permission:rules even on high risk permission (D.13L Block E)", () => {
    const lowRisk: TaskPermissionView = { ...permission, risk: "low" };
    const lowResult = buildTaskSuggestions({ ...baseInputs, permission: lowRisk });
    expect(lowResult.some((s) => s.id === "permission:rules")).toBe(false);

    const highResult = buildTaskSuggestions({ ...baseInputs, permission });
    expect(highResult.some((s) => s.id === "permission:rules")).toBe(false);
  });

  it("never emits permission:details (D.13L Block E)", () => {
    const result = buildTaskSuggestions({ ...baseInputs, permission });
    expect(result.find((s) => s.id === "permission:details")).toBeUndefined();
    expect(result.some((s) => s.source === "permission")).toBe(false);
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
    // 权限来源已停用，改由 setup 来源校验英文文案。
    const result = buildTaskSuggestions({
      ...baseInputs,
      language: "en-US",
      setupHint: "model not configured",
    });
    expect(result[0].label).toBe("Continue model setup");
  });
});
