import { describe, expect, it } from "vitest";
import {
  currentRequestUserActionConstraints,
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

  it("does not merge secret-output bans with later tool-use permission", () => {
    const constraints = parseUserActionConstraints(
      "请不要输出 key；用真实工具检查当前模型诊断状态",
    );

    expect(constraints.forbidAllTools).toBe(false);
    expect(constraints.forbidShell).toBe(false);
  });

  it("keeps readonly constraints scoped to their request owner across interrupted turns", () => {
    const readonly = parseUserActionConstraints("只读检查，不要执行命令、测试或 build");
    const state = {
      currentRequestTurnId: "turn-a",
      currentUserActionConstraintsRequestTurnId: "turn-a",
      currentUserActionConstraints: readonly,
    };

    expect(currentRequestUserActionConstraints(state)).toBe(readonly);

    state.currentRequestTurnId = "turn-b";
    expect(currentRequestUserActionConstraints(state)).toBeUndefined();

    state.currentUserActionConstraintsRequestTurnId = "turn-b";
    state.currentUserActionConstraints = parseUserActionConstraints("请直接完成");
    expect(currentRequestUserActionConstraints(state)).toBe(state.currentUserActionConstraints);

    state.currentRequestTurnId = "turn-c";
    expect(currentRequestUserActionConstraints(state)).toBeUndefined();
  });
});
