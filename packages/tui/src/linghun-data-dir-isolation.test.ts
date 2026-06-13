import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinghunConfig } from "@linghun/config";
import { getSessionRootDir, loadConfig, resolveStoragePaths } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import type { AgentRun } from "./tui-data-types.js";

async function createMinimalContext(projectPath: string, config: LinghunConfig) {
  const paths = resolveStoragePaths(config, projectPath);
  return {
    projectPath,
    config,
    agents: [] as AgentRun[],
    memory: {
      sessionDir: paths.memorySession,
      projectDir: paths.memoryProject,
      userDir: paths.memoryUser,
      projectRulesPath: join(projectPath, "LINGHUN.md"),
      projectRulesExists: false,
      projectRulesSummary: "",
      candidates: [],
      accepted: [],
      rejected: [],
      disabled: [],
      retired: [],
      learningMode: "off" as const,
    },
  };
}

describe("LINGHUN_DATA_DIR isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("isolates agent-runs, memory/session, failures under LINGHUN_DATA_DIR", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-isolation-"));
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-data-"));

    vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

    try {
      const config = await loadConfig(project);
      const paths = resolveStoragePaths(config, project);

      expect(paths.agentRuns).toContain(isolatedDataDir);
      expect(paths.agentRuns).not.toContain(join(project, ".linghun"));
      expect(paths.failures).toContain(isolatedDataDir);
      expect(paths.failures).not.toContain(join(project, ".linghun"));
      expect(paths.memorySession).toContain(isolatedDataDir);
      expect(paths.memorySession).not.toContain(join(project, ".linghun"));
      expect(paths.sessions).toContain(isolatedDataDir);
      expect(paths.jobs).toContain(isolatedDataDir);
      expect(paths.logs).toContain(isolatedDataDir);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("writes agent-runs under isolated data dir when LINGHUN_DATA_DIR is set", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-agent-iso-"));
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-data-"));

    vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

    try {
      const config = await loadConfig(project);
      const context = await createMinimalContext(project, config);

      const agent: AgentRun = {
        id: "test-agent-001",
        type: "worker",
        displayName: "test-worker",
        task: "test task",
        status: "running",
        role: "executor",
        provider: "openai",
        model: "gpt-4o",
        permissionMode: "default",
        transcriptSessionId: "test-session",
        transcriptPath: join(project, "test.log"),
        contextSummary: "test context",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        summary: "test agent",
        cost: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCny: 0,
        },
        mailbox: [],
      };

      context.agents.push(agent);

      const agentRunsDir = resolveStoragePaths(config, project).agentRuns;
      expect(agentRunsDir).toContain(isolatedDataDir);

      await mkdir(agentRunsDir, { recursive: true });
      await writeFile(join(agentRunsDir, "test-agent-001.json"), JSON.stringify(agent), "utf8");

      const files = await readdir(agentRunsDir);
      expect(files).toContain("test-agent-001.json");

      const projectDotLinghun = join(project, ".linghun", "agent-runs");
      await expect(readdir(projectDotLinghun)).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("writes failures under isolated data dir when LINGHUN_DATA_DIR is set", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-failure-iso-"));
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-data-"));

    vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

    try {
      const config = await loadConfig(project);
      const state = createFailureLearningState(project, config);

      expect(state.directory).toContain(isolatedDataDir);
      expect(state.directory).not.toContain(join(project, ".linghun"));

      const { buildFailureRecord, writeFailureRecord } = await import(
        "./failure-learning-runtime.js"
      );
      const record = buildFailureRecord(state, {
        category: "tool_failure",
        failureSummary: "test failure",
        rootCauseGuess: "test root cause",
        avoidNextTime: "avoid this",
        sourceRef: "test:001",
      });

      await writeFailureRecord(state, record);

      const files = await readdir(state.directory);
      expect(files.length).toBeGreaterThan(0);

      const projectDotLinghun = join(project, ".linghun", "failures");
      await expect(readdir(projectDotLinghun)).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("writes memory/session under isolated data dir when LINGHUN_DATA_DIR is set", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-memory-iso-"));
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-data-"));

    vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

    try {
      const config = await loadConfig(project);
      const context = await createMinimalContext(project, config);

      expect(context.memory.sessionDir).toContain(isolatedDataDir);
      expect(context.memory.sessionDir).not.toContain(join(project, ".linghun"));

      await mkdir(context.memory.sessionDir, { recursive: true });
      await writeFile(join(context.memory.sessionDir, "test.json"), "{}", "utf8");

      const files = await readdir(context.memory.sessionDir);
      expect(files).toContain("test.json");

      const projectDotLinghun = join(project, ".linghun", "memory", "session");
      await expect(readdir(projectDotLinghun)).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("writes verification logs under isolated data dir when LINGHUN_DATA_DIR is set", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-verify-iso-"));
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-data-"));

    vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

    try {
      const config = await loadConfig(project);
      const paths = resolveStoragePaths(config, project);

      expect(paths.logs).toContain(isolatedDataDir);
      expect(paths.logs).not.toContain(join(project, ".linghun"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps runtime data separate for projects with the same basename", async () => {
    const root1 = await mkdtemp(join(tmpdir(), "linghun-same-runtime-a-"));
    const root2 = await mkdtemp(join(tmpdir(), "linghun-same-runtime-b-"));
    const project1 = join(root1, "same-runtime");
    const project2 = join(root2, "same-runtime");
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-data-"));
    await mkdir(project1, { recursive: true });
    await mkdir(project2, { recursive: true });

    vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

    try {
      const paths1 = resolveStoragePaths(await loadConfig(project1), project1);
      const paths2 = resolveStoragePaths(await loadConfig(project2), project2);

      for (const key of ["memorySession", "failures", "agentRuns", "cache", "index"] as const) {
        expect(paths1[key]).toContain(isolatedDataDir);
        expect(paths2[key]).toContain(isolatedDataDir);
        expect(paths1[key]).not.toBe(paths2[key]);
      }

      await mkdir(paths1.failures, { recursive: true });
      await mkdir(paths2.failures, { recursive: true });
      await writeFile(join(paths1.failures, "one.json"), "{}", "utf8");
      await writeFile(join(paths2.failures, "two.json"), "{}", "utf8");

      expect(await readdir(paths1.failures)).toEqual(["one.json"]);
      expect(await readdir(paths2.failures)).toEqual(["two.json"]);

      const store1 = new SessionStore({
        sessionRootDir: getSessionRootDir(),
        projectPath: project1,
      });
      const store2 = new SessionStore({
        sessionRootDir: getSessionRootDir(),
        projectPath: project2,
      });
      const session1 = await store1.create();
      const session2 = await store2.create();

      expect(session1.transcriptPath).toContain(isolatedDataDir);
      expect(session2.transcriptPath).toContain(isolatedDataDir);
      expect(session1.transcriptPath).not.toBe(session2.transcriptPath);
      await expect(store1.resume(session2.id)).rejects.toThrow("未找到会话");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
