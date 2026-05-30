import { describe, expect, it } from "vitest";
import {
  buildFailureLearningPanel,
  formatFailureLearningDetails,
} from "./failure-learning-presenter.js";
import {
  createFailureLearningState,
  mergeFailureRecord,
  setFailureRecordStatus,
} from "./failure-learning-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";

function seed(overrides: Partial<FailureLearningInput> = {}): FailureLearningInput {
  return {
    category: "provider_failure",
    failureSummary: "provider request failed code=PROVIDER_RATE_LIMITED",
    rootCauseGuess: "rate limited",
    avoidNextTime: "back off before retrying provider calls",
    sourceRef: "evidence:secret-id-xyz",
    relatedTarget: "PROVIDER_RATE_LIMITED",
    severity: "high",
    ...overrides,
  };
}

describe("D.14B Failure Learning — presenter (summary-first)", () => {
  it("empty state renders neutral summary with no actions", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    const panel = buildFailureLearningPanel(state, "zh-CN");
    expect(panel.title).toBe("/failures");
    expect(panel.tone).toBe("neutral");
    expect(panel.summary?.[0]).toContain("活跃 0");
    expect(panel.actions ?? []).toHaveLength(0);
  });

  it("active lessons surface avoid-text and risk-hint caveat, never raw sourceRef", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    mergeFailureRecord(state, seed());
    const panel = buildFailureLearningPanel(state, "zh-CN");
    expect(panel.tone).toBe("warning");
    const joined = (panel.summary ?? []).join("\n");
    expect(joined).toContain("back off");
    expect(joined).toContain("不代表问题已修复");
    expect(joined).not.toContain("secret-id-xyz");
    expect(panel.actions).toContain("/failures resolve <id>");
    expect(panel.actions).toContain("/failures ignore <id>");
  });

  it("details list marks root cause as inferred and includes the resolve/ignore note", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    mergeFailureRecord(state, seed());
    const details = formatFailureLearningDetails(state, "zh-CN");
    expect(details).toContain("根因(推断)");
    expect(details).toContain("/failures resolve");
    expect(details).toContain("不代表已修复");
  });

  it("English locale renders English labels", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    mergeFailureRecord(state, seed());
    const panel = buildFailureLearningPanel(state, "en-US");
    expect((panel.summary ?? []).join("\n")).toContain("Failure learning");
    expect((panel.summary ?? []).join("\n")).toContain("not proof anything is fixed");
  });

  it("resolved records do not appear as active in the summary counts", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    const { record } = mergeFailureRecord(state, seed());
    setFailureRecordStatus(record, "resolved");
    const panel = buildFailureLearningPanel(state, "zh-CN");
    expect(panel.summary?.[0]).toContain("活跃 0");
    expect(panel.summary?.[0]).toContain("已解决 1");
  });
});
