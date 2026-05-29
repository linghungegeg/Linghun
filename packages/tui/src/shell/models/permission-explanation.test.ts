import { describe, expect, it } from "vitest";
import {
  explainHowToUpdate,
  explainPathSafety,
  explainPolicyVerdict,
  explainSemantic,
  sanitizePermissionReason,
} from "./permission-explanation.js";

describe("permission-explanation: sanitize rule UUID", () => {
  it("移除 '命中 deny 规则：<UUID>' 中的 rule id，保留语义", () => {
    const sanitized = sanitizePermissionReason(
      "命中 deny 规则：3b2a-1234-5678-9012-abcdef. 后续提示...",
    );
    expect(sanitized).toContain("命中拒绝规则");
    expect(sanitized).not.toMatch(
      /[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{6,}/iu,
    );
  });

  it("移除 '命中 ask 规则：xxx'", () => {
    expect(sanitizePermissionReason("命中 ask 规则：rule-id-here")).toContain(
      "命中需确认规则",
    );
  });

  it("移除 '命中 allow 规则：xxx'", () => {
    expect(sanitizePermissionReason("命中 allow 规则：anything")).toContain(
      "命中允许规则",
    );
  });

  it("英文 'Hit deny rule: xxx' 同样剥离 rule id", () => {
    const sanitized = sanitizePermissionReason("Hit deny rule: abc-123-xyz");
    expect(sanitized).toContain("Hit deny rule.");
    expect(sanitized).not.toContain("abc-123-xyz");
  });

  it("非 rule reason 原样保留", () => {
    expect(sanitizePermissionReason("Plan 模式禁止写入。")).toBe(
      "Plan 模式禁止写入。",
    );
  });
});

describe("permission-explanation: semantic / pathSafety 翻译", () => {
  it("destructive 中文短句", () => {
    expect(explainSemantic("destructive", "zh-CN")).toContain("破坏性");
  });

  it("readonly 中文短句", () => {
    expect(explainSemantic("readonly", "zh-CN")).toContain("只读");
  });

  it("network English short", () => {
    expect(explainSemantic("network", "en-US")).toContain("network");
  });

  it("sensitive_path 中文短句", () => {
    expect(explainPathSafety("sensitive_path", "zh-CN")).toContain("敏感");
  });
});

describe("permission-explanation: how-to-update 指引", () => {
  it("中文指向 /permissions", () => {
    expect(explainHowToUpdate("zh-CN")).toContain("/permissions");
  });

  it("英文指向 /permissions", () => {
    expect(explainHowToUpdate("en-US")).toContain("/permissions");
  });
});

describe("permission-explanation: explainPolicyVerdict 整合", () => {
  it("装配多行说明且必含 /permissions 指引", () => {
    const lines = explainPolicyVerdict(
      {
        semantic: "destructive",
        pathSafety: "sensitive_path",
        redactedSummary: "rm -rf /tmp/foo",
        reason: "命中 deny 规则：a-b-c-d-e",
      },
      "zh-CN",
    );
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join("\n")).toContain("/permissions");
    expect(lines.join("\n")).toContain("破坏性");
    expect(lines.join("\n")).not.toMatch(
      /[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{6,}/iu,
    );
  });

  it("空 verdict 仍至少返回 /permissions 指引", () => {
    const lines = explainPolicyVerdict({}, "zh-CN");
    expect(lines.join("\n")).toContain("/permissions");
  });
});
