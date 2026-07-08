import { describe, expect, it } from "vitest";
import {
  forbidsVerificationEvidence,
  hasReadOnlyUserConstraint,
  parseUserActionConstraints,
} from "./user-action-constraints.js";

describe("user-action-constraints", () => {
  it("treats no-test wording as verification-only constraint", () => {
    const constraints = parseUserActionConstraints("不要跑测试，但可以 Read/Grep 看源码");

    expect(constraints.forbidTests).toBe(true);
    expect(constraints.forbidShell).toBe(false);
    expect(constraints.forbidAllTools).toBe(false);
    expect(forbidsVerificationEvidence(constraints)).toBe(true);
  });

  it("treats readonly positioning as write constraint without banning read tools", () => {
    const constraints = parseUserActionConstraints("先定位，不要改文件");

    expect(constraints.readonlyOnly).toBe(true);
    expect(constraints.forbidWrite).toBe(true);
    expect(constraints.forbidShell).toBe(false);
    expect(constraints.forbidAllTools).toBe(false);
    expect(hasReadOnlyUserConstraint(constraints)).toBe(true);
  });

  it("recognizes explicit all-tool bans", () => {
    const constraints = parseUserActionConstraints("不要调用任何工具，只回答");

    expect(constraints.forbidAllTools).toBe(true);
    expect(constraints.forbidShell).toBe(true);
    expect(forbidsVerificationEvidence(constraints)).toBe(true);
  });
});
