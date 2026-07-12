import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFailureLearningPanel } from "./failure-learning-presenter.js";
import {
  buildFailureLearningSummaryForPrompt,
  buildFailureRecord,
  commitFailureLearningInput,
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
import {
  atomicWriteMemoryFile,
  withMemoryDirectoryLock,
} from "./memory-extraction-runtime.js";

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

  it("preserves the public merge then write flow without losing its count update", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    const first = mergeFailureRecord(
      state,
      input({ failureSummary: "Bash exited non-zero at line 42" }),
    );
    await writeFailureRecord(state, first.record);
    const second = mergeFailureRecord(
      state,
      input({ failureSummary: "Bash exited non-zero at line 99", sourceRef: "evidence:second" }),
    );
    await writeFailureRecord(state, second.record);

    const [persisted] = await loadFailureRecords(state);
    expect(persisted).toMatchObject({
      id: first.record.id,
      count: 2,
      failureSummary: "Bash exited non-zero at line 99",
      sourceRef: "evidence:second",
    });
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

  it("fails closed on unreadable record I/O instead of treating the directory as empty", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    const initial = await commitFailureLearningInput(state, input());
    if (initial.status !== "committed") throw new Error("expected initial failure commit");
    await mkdir(join(state.directory, "locked.json"));

    await expect(commitFailureLearningInput(state, input())).rejects.toThrow();
    const persisted = JSON.parse(
      await readFile(join(state.directory, `${initial.record.id}.json`), "utf8"),
    ) as { count: number };
    expect(persisted.count).toBe(1);
    expect(await loadFailureRecords(state)).toEqual(state.records);
    expect(state.records[0].count).toBe(1);
    expect((await readdir(state.directory)).filter((file) => file.endsWith(".json"))).toHaveLength(2);
  });

  it("records degraded warning when persistence write fails and /failures can display it", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    const blockedPath = join(project, "not-a-directory");
    await (await import("node:fs/promises")).writeFile(blockedPath, "blocked", "utf8");
    state.directory = blockedPath;
    const record = buildFailureRecord(state, input());

    await expect(writeFailureRecord(state, record)).rejects.toThrow();

    expect(state.degradedWarnings.length).toBeGreaterThan(0);
    const panel = buildFailureLearningPanel(state, "zh-CN");
    expect(panel.summary?.join("\n")).toContain("降级");
    expect(panel.detailsText).toContain("降级警告");
    expect(panel.detailsText).toContain("write_failed");
  });

  it("serializes two 1,000-write windows and keeps mixed dedupe counts exact", async () => {
    const project = await makeProject();
    const states = [createFailureLearningState(project), createFailureLearningState(project)];
    await Promise.all(
      states.map(async (state) => {
        for (let index = 0; index < 1_000; index += 1) {
          const result = await commitFailureLearningInput(
            state,
            input(
              index % 2 === 0
                ? { failureSummary: "Bash exited non-zero at line 42" }
                : {
                    category: "provider_failure",
                    failureSummary: "provider returned gateway error 502",
                    relatedTarget: "provider",
                  },
            ),
          );
          expect(result.status).toBe("committed");
        }
      }),
    );

    const records = await loadFailureRecords(states[0]);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.count).sort((left, right) => left - right)).toEqual([
      1_000, 1_000,
    ]);
    expect((await readdir(states[0].directory)).filter((file) => file.endsWith(".json"))).toHaveLength(2);
  }, 60_000);

  it("checks commitGuard at the atomic replacement boundary and leaves no disk artifact", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    await withMemoryDirectoryLock(state.directory, async (lockToken) => {
      const committed = await atomicWriteMemoryFile(
        join(state.directory, "guarded.json"),
        "guarded\n",
        lockToken,
        () => false,
      );
      expect(committed).toBe(false);
    });

    const files = await readdir(state.directory);
    expect(files.filter((file) => file.endsWith(".json"))).toEqual([]);
    expect(files.some((file) => file.includes(".tmp-") || file.includes(".bak-"))).toBe(false);
  });

  it("recovers a backup-only replacement artifact before the public startup load", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    const record = buildFailureRecord(state, input());
    await mkdir(state.directory, { recursive: true });
    await writeFile(
      join(state.directory, `${record.id}.json.bak-crashed-writer`),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );

    const records = await loadFailureRecords(state);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: record.id, count: 1 });
    expect(await readdir(state.directory)).toEqual([`${record.id}.json`]);
  });

  it.each(["resolved", "ignored"] as const)(
    "merges a stale %s writer into the latest disk record without replacing its fields",
    async (status) => {
    const project = await makeProject();
    const staleWindow = createFailureLearningState(project);
    const activeWindow = createFailureLearningState(project);
    await commitFailureLearningInput(
      activeWindow,
      input({ failureSummary: "Bash exited non-zero at line 42", sourceRef: "evidence:first" }),
    );
    staleWindow.records = await loadFailureRecords(staleWindow);
    await commitFailureLearningInput(
      activeWindow,
      input({ failureSummary: "Bash exited non-zero at line 99", sourceRef: "evidence:latest" }),
    );

    const staleRecord = staleWindow.records[0];
    setFailureRecordStatus(staleRecord, status);
    await writeFailureRecord(staleWindow, staleRecord);

    const [persisted] = await loadFailureRecords(activeWindow);
    expect(persisted).toMatchObject({
      count: 2,
      failureSummary: "Bash exited non-zero at line 99",
      sourceRef: "evidence:latest",
      status,
    });
    },
  );

  it("keeps status unchanged when a copied status update cannot acquire persistence", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    const committed = await commitFailureLearningInput(state, input());
    expect(committed.status).toBe("committed");
    const active = state.records[0];
    const blockedPath = join(project, "blocked-status-path");
    await writeFile(blockedPath, "blocked", "utf8");
    state.directory = blockedPath;

    await expect(writeFailureRecord(state, { ...active, status: "resolved" })).rejects.toThrow();
    expect(active.status).toBe("active");
    expect(state.records[0].status).toBe("active");
  });

  it("uses id as a stable canonical tie-break for same-timestamp legacy duplicates", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    const now = new Date("2026-07-12T01:00:00.000Z");
    const first = { ...buildFailureRecord(state, input(), now), count: 2, status: "resolved" as const };
    const second = { ...buildFailureRecord(state, input(), now), count: 3, status: "ignored" as const };
    await mkdir(state.directory, { recursive: true });
    await writeFile(join(state.directory, `${second.id}.json`), `${JSON.stringify(second)}\n`, "utf8");
    await writeFile(join(state.directory, `${first.id}.json`), `${JSON.stringify(first)}\n`, "utf8");

    const expectedCanonical = [first, second].sort((left, right) => left.id.localeCompare(right.id))[0];
    const [loaded] = await loadFailureRecords(state);
    expect(loaded).toMatchObject({
      id: expectedCanonical.id,
      count: 5,
      status: expectedCanonical.status,
    });
    const next = await commitFailureLearningInput(state, input());
    if (next.status !== "committed") throw new Error("expected committed tie-break update");
    expect(next.record).toMatchObject({ id: expectedCanonical.id, count: 6 });
    expect((await readdir(state.directory)).filter((file) => file.endsWith(".json"))).toHaveLength(2);
  });

  it("keeps resolve after capture start, but reactivates a failure captured after resolve", async () => {
    const project = await makeProject();
    const state = createFailureLearningState(project);
    const initial = await commitFailureLearningInput(state, input());
    if (initial.status !== "committed") throw new Error("expected initial failure commit");
    let pendingCapture: Promise<Awaited<ReturnType<typeof commitFailureLearningInput>>>;

    await withMemoryDirectoryLock(state.directory, async (lockToken) => {
      pendingCapture = commitFailureLearningInput(state, input());
      await new Promise((resolve) => setTimeout(resolve, 5));
      await atomicWriteMemoryFile(
        join(state.directory, `${initial.record.id}.json`),
        `${JSON.stringify({ ...initial.record, status: "resolved" }, null, 2)}\n`,
        lockToken,
      );
    });
    const capturedBeforeResolve = await pendingCapture!;
    if (capturedBeforeResolve.status !== "committed") {
      throw new Error("expected capture started before resolve to commit");
    }
    expect(capturedBeforeResolve.record.status).toBe("resolved");

    const [resolved] = await loadFailureRecords(state);
    expect(resolved.status).toBe("resolved");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const reactivated = await commitFailureLearningInput(state, input());
    if (reactivated.status !== "committed") throw new Error("expected failure reactivation");
    expect(reactivated.record.status).toBe("active");
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
