import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFailureLearningSummaryForPrompt,
  buildFailureRecord,
  createFailureLearningState,
  failureDedupeHash,
  getFailureLearningDirectory,
  loadFailureRecords,
  mergeFailureRecord,
  resolveFailureProjectScope,
  sanitizeFailureText,
  sanitizeRelatedTarget,
  selectActiveLessons,
  setFailureRecordStatus,
  writeFailureRecord,
} from "./failure-learning-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lh-failure-"));
  tempDirs.push(dir);
  return dir;
}

function input(overrides: Partial<FailureLearningInput> = {}): FailureLearningInput {
  return {
    category: "tool_failure",
    failureSummary: "Bash exited non-zero: command not found",
    rootCauseGuess: "command missing",
    avoidNextTime: "check the command exists before running",
    sourceRef: "evidence:abc",
    relatedTarget: "Bash",
    severity: "medium",
    ...overrides,
  };
}

describe("D.14B Failure Learning — sanitization", () => {
  it("redacts sk- keys, Bearer tokens, api_key, Authorization", () => {
    const raw =
      "auth failed Authorization: Bearer abcDEF123.token api_key=sk-secret123 key sk-AAAbbbCCC111";
    const out = sanitizeFailureText(raw);
    expect(out).not.toContain("sk-secret123");
    expect(out).not.toContain("sk-AAAbbbCCC111");
    expect(out).not.toMatch(/Bearer\s+abcDEF/);
    expect(out).not.toMatch(/Authorization:\s*Bearer\s+abcDEF/);
    expect(out).toContain("Authorization=***");
  });

  it("redacts baseUrl / http(s) URLs", () => {
    const out = sanitizeFailureText("POST https://relay.example.com/v1/messages failed 500");
    expect(out).not.toContain("relay.example.com");
    expect(out).toContain("[url]");
  });

  it("redacts Windows and Unix absolute paths", () => {
    const win = sanitizeFailureText("read C:\\Users\\Admin\\.linghun\\provider.env failed");
    expect(win).not.toContain("C:\\Users\\Admin");
    expect(win).toContain("[local-path]");
    const unix = sanitizeFailureText("read /home/admin/project/secret/key failed");
    expect(unix).not.toContain("/home/admin/project");
    expect(unix).toContain("[local-path]");
  });

  it("redacts private key blocks and provider tokens", () => {
    const out = sanitizeFailureText(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEv...\n-----END RSA PRIVATE KEY----- ghp_0123456789abcdefABCDEF0123456789abcd",
    );
    expect(out).toContain("[private-key]");
    expect(out).not.toContain("ghp_0123456789abcdefABCDEF");
  });

  it("sanitizeRelatedTarget drops secrets and truncates", () => {
    expect(sanitizeRelatedTarget(undefined)).toBeUndefined();
    expect(sanitizeRelatedTarget("Bearer sk-abc123")).not.toContain("sk-abc123");
  });

  it("project scope is a sanitized basename, never an absolute path", () => {
    const scope = resolveFailureProjectScope("C:\\Users\\Admin\\Linghun");
    expect(scope).toBe("Linghun");
    expect(scope).not.toContain("C:\\");
  });

  it("key/token/password fields keep their name and never leak '$1' or a bare '=***'", () => {
    const out = sanitizeFailureText(
      "api_key=sk-secret123 token: tok-abcdef123456 password=hunter2 access-key = AKIAabc",
    );
    // 捕获组修复：不得泄漏字面 "$1"，也不得出现裸 "=***"（丢了字段名）。
    expect(out).not.toContain("$1");
    expect(out).not.toMatch(/(^|\s)=\*\*\*/);
    // 字段名保留 + 原值脱敏。
    expect(out).toContain("api_key=***");
    expect(out).toMatch(/token[:=]\*\*\*/);
    expect(out).toContain("password=***");
    expect(out).not.toContain("sk-secret123");
    expect(out).not.toContain("tok-abcdef123456");
    expect(out).not.toContain("hunter2");
  });
});

describe("D.14B Failure Learning — dedupe", () => {
  it("same category+target+normalized message → same hash; line numbers normalized away", () => {
    const a = failureDedupeHash({
      category: "tool_failure",
      relatedTarget: "Bash",
      failureSummary: "error at line 42 column 7",
      projectScope: "p",
    });
    const b = failureDedupeHash({
      category: "tool_failure",
      relatedTarget: "Bash",
      failureSummary: "error at line 999 column 1",
      projectScope: "p",
    });
    expect(a).toBe(b);
  });

  it("different category → different hash", () => {
    const a = failureDedupeHash({
      category: "tool_failure",
      failureSummary: "x",
      projectScope: "p",
    });
    const b = failureDedupeHash({
      category: "provider_failure",
      failureSummary: "x",
      projectScope: "p",
    });
    expect(a).not.toBe(b);
  });

  it("hash does not contain raw secret / baseURL / absolute path", () => {
    const h = failureDedupeHash({
      category: "provider_failure",
      relatedTarget: "https://relay.example.com",
      failureSummary: "sk-secret123 at C:\\Users\\Admin\\key",
      projectScope: "p",
    });
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(h).not.toContain("relay.example.com");
    expect(h).not.toContain("sk-secret");
  });

  it("mergeFailureRecord merges count/lastSeen instead of appending duplicates", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    const first = mergeFailureRecord(
      state,
      input({ failureSummary: "Bash exited non-zero at line 42" }),
      new Date("2026-05-30T00:00:00Z"),
    );
    expect(first.isNew).toBe(true);
    expect(first.record.count).toBe(1);
    const second = mergeFailureRecord(
      state,
      input({ failureSummary: "Bash exited non-zero at line 5" }),
      new Date("2026-05-30T01:00:00Z"),
    );
    expect(second.isNew).toBe(false);
    expect(state.records.length).toBe(1);
    expect(second.record.count).toBe(2);
    expect(second.record.lastSeen).toBe("2026-05-30T01:00:00.000Z");
  });

  it("resolved record re-activates when the same failure recurs", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    const { record } = mergeFailureRecord(state, input());
    setFailureRecordStatus(record, "resolved");
    const again = mergeFailureRecord(state, input());
    expect(again.record.status).toBe("active");
    expect(again.record.count).toBe(2);
  });
});

describe("D.14B Failure Learning — record build / inferred flag", () => {
  it("every record is sanitized and rootCause is marked inferred", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    const record = buildFailureRecord(
      state,
      input({
        failureSummary: "failed POST https://relay.example.com sk-leak123",
        rootCauseGuess: "provider auth via Bearer abc.def",
      }),
    );
    expect(record.inferred).toBe(true);
    expect(record.failureSummary).not.toContain("relay.example.com");
    expect(record.failureSummary).not.toContain("sk-leak123");
    expect(record.rootCauseGuess).not.toMatch(/Bearer\s+abc/);
    expect(record.status).toBe("active");
    expect(record.count).toBe(1);
  });
});

describe("D.14B Failure Learning — persistence (Windows-compatible paths)", () => {
  it("writes one <id>.json under .linghun/failures and reloads it", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    expect(getFailureLearningDirectory(project)).toBe(join(project, ".linghun", "failures"));
    const { record } = mergeFailureRecord(state, input());
    await writeFailureRecord(state, record);
    const files = await readdir(state.directory);
    expect(files).toEqual([`${record.id}.json`]);
    const reloaded = await loadFailureRecords(state);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe(record.id);
    expect(reloaded[0].inferred).toBe(true);
  });

  it("persisted file never contains secret/baseUrl/absolute path", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    const { record } = mergeFailureRecord(
      state,
      input({
        category: "provider_failure",
        failureSummary: "POST https://relay.example.com/v1/messages api_key=sk-leak999 failed",
        relatedTarget: "https://relay.example.com",
        rootCauseGuess: "Authorization: Bearer leak.token rejected",
      }),
    );
    await writeFailureRecord(state, record);
    const raw = await readFile(join(state.directory, `${record.id}.json`), "utf8");
    expect(raw).not.toContain("relay.example.com");
    expect(raw).not.toContain("sk-leak999");
    expect(raw).not.toContain("Bearer leak.token");
  });

  it("loadFailureRecords skips corrupt files without throwing", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    const { record } = mergeFailureRecord(state, input());
    await writeFailureRecord(state, record);
    await writeFailureRecord({ ...state, directory: state.directory }, record);
    // drop a corrupt file
    const corruptPath = join(state.directory, "broken.json");
    await (await import("node:fs/promises")).writeFile(corruptPath, "{not json", "utf8");
    const reloaded = await loadFailureRecords(state);
    expect(reloaded.length).toBe(1);
  });
});

describe("D.14B Failure Learning — prompt summary", () => {
  it("returns null when there are no active lessons", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    expect(buildFailureLearningSummaryForPrompt(state)).toBeNull();
  });

  it("summary text contains no secret/baseUrl/absolute path/sourceRef", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    mergeFailureRecord(
      state,
      input({
        category: "provider_failure",
        failureSummary: "POST https://relay.example.com sk-leak999",
        avoidNextTime: "back off before retrying provider calls",
        sourceRef: "evidence:super-secret-id",
      }),
    );
    const summary = buildFailureLearningSummaryForPrompt(state);
    expect(summary).not.toBeNull();
    expect(summary?.text).not.toContain("relay.example.com");
    expect(summary?.text).not.toContain("sk-leak999");
    expect(summary?.text).not.toContain("super-secret-id");
    expect(summary?.text).toContain("back off");
  });

  it("ignored/resolved lessons are not selected for the prompt", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    const { record: r1 } = mergeFailureRecord(state, input({ failureSummary: "alpha" }));
    mergeFailureRecord(state, input({ category: "git_operation_failure", failureSummary: "beta" }));
    setFailureRecordStatus(r1, "ignored");
    const lessons = selectActiveLessons(state);
    expect(lessons.map((l) => l.category)).toEqual(["git_operation_failure"]);
  });

  it("high severity lessons sort before lower severity", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    mergeFailureRecord(
      state,
      input({ category: "tool_failure", failureSummary: "low one", severity: "low" }),
    );
    mergeFailureRecord(
      state,
      input({ category: "provider_failure", failureSummary: "high one", severity: "high" }),
    );
    const lessons = selectActiveLessons(state);
    expect(lessons[0].severity).toBe("high");
  });

  it("many long-avoid records → summary.text is always valid JSON, length-bounded, no leaks", () => {
    const state = createFailureLearningState("C:\\proj\\Demo");
    // 制造大量超长 avoidNextTime（含 baseUrl/secret/绝对路径），每条都很长。
    for (let i = 0; i < 12; i += 1) {
      mergeFailureRecord(
        state,
        input({
          category: "provider_failure",
          failureSummary: `failure number ${i} variant`,
          relatedTarget: `code-${i}`,
          severity: "high",
          avoidNextTime: `back off and verify provider config before retrying request number ${i}; ${"do not paste https://relay.example.com/v1/messages or sk-leak999secret or C:\\Users\\Admin\\.linghun\\provider.env into the answer ".repeat(3)}`,
          sourceRef: `evidence:super-secret-id-${i}`,
        }),
      );
    }
    const summary = buildFailureLearningSummaryForPrompt(state);
    expect(summary).not.toBeNull();
    // 合法 JSON（绝不硬截断字符串）。
    const parsed = JSON.parse(summary?.text ?? "");
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    // count 与实际保留条目一致。
    expect(summary?.count).toBe(parsed.length);
    // 长度受控。
    expect(summary?.text.length ?? 0).toBeLessThanOrEqual(900);
    // 不泄漏 secret/baseUrl/绝对路径/sourceRef。
    expect(summary?.text).not.toContain("relay.example.com");
    expect(summary?.text).not.toContain("sk-leak999secret");
    expect(summary?.text).not.toContain("C:\\Users\\Admin");
    expect(summary?.text).not.toContain("super-secret-id");
    expect(summary?.text).not.toContain("…]");
  });
});
