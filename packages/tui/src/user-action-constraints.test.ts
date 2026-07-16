import { describe, expect, it } from "vitest";
import {
  currentRequestUserActionConstraints,
  forbidsVerificationEvidence,
  hasReadOnlyUserConstraint,
  parseUserActionConstraints,
  verificationStepConstraintReason,
} from "./user-action-constraints.js";

describe("user-action-constraints", () => {
  it("treats no-test wording as verification-only constraint", () => {
    const constraints = parseUserActionConstraints("不要跑测试，但可以 Read/Grep 看源码");

    expect(constraints.forbidTests).toBe(true);
    expect(constraints.forbidShell).toBe(false);
    expect(constraints.forbidAllTools).toBe(false);
    expect(forbidsVerificationEvidence(constraints)).toBe(false);
  });

  it("keeps explicit no-write wording hard without promoting sequencing to readonly", () => {
    const constraints = parseUserActionConstraints("先定位，不要改文件");

    expect(constraints.readonlyOnly).toBe(false);
    expect(constraints.forbidWrite).toBe(true);
    expect(constraints.forbidShell).toBe(false);
    expect(constraints.forbidAllTools).toBe(false);
    expect(hasReadOnlyUserConstraint(constraints)).toBe(true);
  });

  it.each([
    "先看代码然后修复问题",
    "先只看代码，然后修复问题",
    "先只读审计，再修复问题",
    "先检查清楚，再修改文件",
    "先分析根因；然后编辑实现",
    "inspect first, then fix the implementation",
    "read-only first, then fix the implementation",
  ])("does not turn ordered implementation intent into a hard deny: %s", (text) => {
    const constraints = parseUserActionConstraints(text);

    expect(constraints.readonlyOnly).toBe(false);
    expect(constraints.forbidWrite).toBe(false);
    expect(hasReadOnlyUserConstraint(constraints)).toBe(false);
  });

  it.each([
    "不要停在只读审计，直接修复",
    "不要只停留在只读分析，直接修改实现",
    "不要只读审计，直接实现修复",
    "do not stop at read-only inspection; fix the implementation",
  ])("treats a negated readonly terminal state as implementation intent: %s", (text) => {
    const constraints = parseUserActionConstraints(text);

    expect(constraints.readonlyOnly).toBe(false);
    expect(constraints.forbidWrite).toBe(false);
    expect(hasReadOnlyUserConstraint(constraints)).toBe(false);
  });

  it.each([
    "修复把只读审计误判为全局只读的问题",
    "实现 audit only 文案解析",
    "修复只检查分支 bug",
    "fix the read-only constraint parser",
  ])("does not treat implementation work about readonly wording as a hard deny: %s", (text) => {
    const constraints = parseUserActionConstraints(text);

    expect(constraints.readonlyOnly).toBe(false);
    expect(constraints.forbidWrite).toBe(false);
    expect(hasReadOnlyUserConstraint(constraints)).toBe(false);
  });

  it.each([
    "普通问答里提到不要修改文件，为什么会触发硬门控",
    "不要修改文件这句话是关键词正则还是语义判断",
    "只读审计是不是会被当成整轮硬限制",
    "为什么不要 build 会阻止验证",
    "不要修改文件吗？",
    "do not edit files is this parsed by regex or semantic intent",
    'Does "do not run tests" trigger a hard gate?',
    '"no tools" is a constraint wording example',
    "do not edit files?",
  ])("does not turn constraint questions or wording discussions into hard runtime state: %s", (text) => {
    const constraints = parseUserActionConstraints(text);

    expect(Object.values(constraints).every((value) => value === false)).toBe(true);
  });

  it("still applies a separate explicit directive after a constraint question", () => {
    const constraints = parseUserActionConstraints(
      "为什么只读会误触？这次不要修改文件",
    );

    expect(constraints.forbidWrite).toBe(true);
  });

  it.each([
    "只读审计，不要修改文件",
    "只读审计，不要修复",
    "只读审计关键词/正则兜底链路，不要修改文件",
    "先检查清楚，但不要写入或编辑文件",
    "audit only; do not edit files",
    "read-only scan keyword/regex fallback, do not edit files",
    "diagnose only, do not modify files",
  ])("keeps explicit readonly intent as a hard request constraint: %s", (text) => {
    const constraints = parseUserActionConstraints(text);

    expect(constraints.readonlyOnly || constraints.forbidWrite).toBe(true);
    expect(constraints.forbidWrite).toBe(true);
    expect(hasReadOnlyUserConstraint(constraints)).toBe(true);
  });

  it("does not treat readonly-only audit as forbidding verification evidence", () => {
    const constraints = parseUserActionConstraints("只读审计，只给审计结果，不改代码");

    expect(constraints.readonlyOnly).toBe(true);
    expect(forbidsVerificationEvidence(constraints)).toBe(false);
    expect(verificationStepConstraintReason(constraints, "test")).toBeUndefined();
  });

  it.each([
    "不要改旧文件，但创建 report.md",
    "只禁止修改 src/**",
    "禁止修改 UI 样式细节",
    "do not edit existing files, but create report.md",
    "do not edit package.json",
  ])("does not promote a target restriction or explicit exception to a global write deny: %s", (text) => {
    const constraints = parseUserActionConstraints(text);

    expect(constraints.readonlyOnly).toBe(false);
    expect(constraints.forbidWrite).toBe(false);
    expect(hasReadOnlyUserConstraint(constraints)).toBe(false);
  });

  it.each([
    "不可以修改文件",
    "不允许写入",
    "不要修复",
    "不要修复这个 bug",
    "cannot edit files",
    "can't write files",
    "not allowed to modify files",
    "do not fix",
    "do not fix this bug",
  ])("keeps negated write permission as a global hard deny: %s", (text) => {
    const constraints = parseUserActionConstraints(text);

    expect(constraints.forbidWrite).toBe(true);
    expect(hasReadOnlyUserConstraint(constraints)).toBe(true);
  });

  it.each([
    "先只看代码，然后不要修复",
    "先只读审计，再不允许修改文件",
    "read-only first, then do not fix",
    "inspect only, then do not edit files",
  ])("does not turn a denied second phase into write permission: %s", (text) => {
    const constraints = parseUserActionConstraints(text);

    expect(constraints.forbidWrite).toBe(true);
    expect(hasReadOnlyUserConstraint(constraints)).toBe(true);
  });

  it.each([
    "no code changes",
    "do not make any changes",
    "without modifying files",
  ])("recognizes global no-change phrases: %s", (text) => {
    expect(parseUserActionConstraints(text).forbidWrite).toBe(true);
  });

  it.each([
    "no changes to UI styles",
    "without modifying UI styles",
  ])("does not promote a target-specific no-change phrase to a global deny: %s", (text) => {
    expect(parseUserActionConstraints(text).forbidWrite).toBe(false);
  });

  it("keeps an explicitly allowed write exception out of the global hard deny", () => {
    for (const text of [
      "不要改旧文件，但允许创建 report.md",
      "不要修改文件但创建 report.md",
      "do not edit files but create report.md",
    ]) {
      expect(parseUserActionConstraints(text).forbidWrite).toBe(false);
    }
  });

  it("does not treat a negated action after a transition as a write exception", () => {
    for (const text of [
      "不要修改文件但不允许创建 report.md",
      "do not edit files but cannot create report.md",
      "只读审计，但可以不修改文件",
      "只允许不修改文件",
      "只读审计，但无需修改文件",
      "只读审计，但不需要修改文件",
      "read-only, but no need to edit files",
    ]) {
      expect(parseUserActionConstraints(text).forbidWrite).toBe(true);
    }
  });

  it("recognizes explicit all-tool bans", () => {
    for (const text of ["不要调用任何工具，只回答", "禁止任何工具", "不要使用工具", "no tools"]) {
      const constraints = parseUserActionConstraints(text);
      expect(constraints.forbidAllTools).toBe(true);
      expect(constraints.forbidShell).toBe(true);
      expect(forbidsVerificationEvidence(constraints)).toBe(true);
    }
  });

  it.each([
    "不要调用 web_search 工具",
    "不要调用外部工具，但可以 Read",
    "do not use external tools, but use Read",
  ])("does not promote a targeted tool restriction to an all-tool ban: %s", (text) => {
    expect(parseUserActionConstraints(text).forbidAllTools).toBe(false);
  });

  it.each([
    "without using tools",
    "answer without tools",
    "use no tools",
    "do not use the tools",
  ])("recognizes global no-tool phrase families: %s", (text) => {
    expect(parseUserActionConstraints(text).forbidAllTools).toBe(true);
  });

  it.each([
    "不要调用任何工具，但不可以用 Read",
    "不要调用任何工具，但不要调用 Bash",
    "do not use any tools, but cannot use Read",
    "不要调用任何工具，但无需调用 Read",
    "不要调用任何工具，但不需要调用 Read",
    "do not use any tools, but no need to use Read",
  ])("does not treat a negated tool action as an explicit exception: %s", (text) => {
    expect(parseUserActionConstraints(text).forbidAllTools).toBe(true);
  });

  it("does not merge secret-output bans with later tool-use permission", () => {
    const constraints = parseUserActionConstraints(
      "请不要输出 key；用真实工具检查当前模型诊断状态",
    );

    expect(constraints.forbidAllTools).toBe(false);
    expect(constraints.forbidShell).toBe(false);
  });

  it("filters only the verification step kinds explicitly forbidden by the current request", () => {
    const constraints = parseUserActionConstraints(
      "不要 build，也不要 lint；test 和 typecheck 可以执行",
    );

    expect(verificationStepConstraintReason(constraints, "build")).toContain("build");
    expect(verificationStepConstraintReason(constraints, "lint")).toContain("lint");
    expect(verificationStepConstraintReason(constraints, "test")).toBeUndefined();
    expect(verificationStepConstraintReason(constraints, "typecheck")).toBeUndefined();
    expect(verificationStepConstraintReason(constraints, "smoke")).toBeUndefined();
  });

  it("does not confuse editing verification-related files with forbidding verification", () => {
    const constraints = parseUserActionConstraints(
      "不要修改测试文件，不要改 build 配置，不要编辑 lint 规则，不要改 typecheck 配置",
    );

    expect(constraints.forbidTests).toBe(false);
    expect(constraints.forbidBuild).toBe(false);
    expect(constraints.forbidLint).toBe(false);
    expect(constraints.forbidTypecheck).toBe(false);
  });

  it("carries a negated run directive across a verification command list", () => {
    const constraints = parseUserActionConstraints(
      "只读审计，不运行 build、test、typecheck、smoke。",
    );

    expect(constraints.forbidBuild).toBe(true);
    expect(constraints.forbidTests).toBe(true);
    expect(constraints.forbidTypecheck).toBe(true);
    expect(constraints.forbidSmoke).toBe(true);
    expect(constraints.forbidLint).toBe(false);
  });

  it("keeps smoke as its own verification constraint kind", () => {
    const constraints = parseUserActionConstraints("不要 smoke，test 可以执行");

    expect(constraints.forbidSmoke).toBe(true);
    expect(constraints.forbidTests).toBe(false);
    expect(verificationStepConstraintReason(constraints, "smoke")).toContain("smoke");
    expect(verificationStepConstraintReason(constraints, "test")).toBeUndefined();
  });

  it.each([
    "不要执行任何测试",
    "不要跑全部测试",
    "do not run any tests",
    "don't run the tests",
    "do not run unit tests",
    "do not run integration tests",
    "do not run e2e tests",
    "do not run the full test suite",
  ])("recognizes quantified test execution bans: %s", (text) => {
    expect(parseUserActionConstraints(text).forbidTests).toBe(true);
  });

  it.each([
    "do not run any commands",
    "do not execute all commands",
    "don't use the shell",
    "不要运行任何终端命令",
    "不要执行所有 shell 命令",
    "不跑命令",
    "不运行命令",
    "不执行命令",
    "no shell",
    "no shell commands",
  ])("recognizes quantified shell execution bans: %s", (text) => {
    expect(parseUserActionConstraints(text).forbidShell).toBe(true);
  });

  it("blocks every executable verification step only for an explicit command or all-tool ban", () => {
    for (const text of ["不要执行命令", "不要调用任何工具"]) {
      const constraints = parseUserActionConstraints(text);
      for (const kind of ["test", "typecheck", "build", "lint", "smoke"] as const) {
        expect(verificationStepConstraintReason(constraints, kind)).toBeDefined();
      }
    }
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

  it("keeps 1,000 alternating request owners from reusing another turn's constraints", () => {
    const state: {
      currentRequestTurnId?: string;
      currentUserActionConstraintsRequestTurnId?: string;
      currentUserActionConstraints?: ReturnType<typeof parseUserActionConstraints>;
    } = {};

    for (let index = 0; index < 1_000; index += 1) {
      const owner = `turn-${index}`;
      state.currentRequestTurnId = owner;
      state.currentUserActionConstraintsRequestTurnId = owner;
      state.currentUserActionConstraints = parseUserActionConstraints(
        index % 2 === 0 ? "不要 build" : "不要 lint",
      );
      expect(currentRequestUserActionConstraints(state)).toBe(state.currentUserActionConstraints);
      state.currentRequestTurnId = `${owner}-next`;
      expect(currentRequestUserActionConstraints(state)).toBeUndefined();
    }
  });
});
