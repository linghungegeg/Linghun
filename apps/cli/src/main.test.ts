import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./cli.js";

describe("CLI", () => {
  it("prints the version without help text", async () => {
    const result = await runCli(["--version"]);

    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints help for the Phase 02 CLI", async () => {
    const result = await runCli(["--help"]);

    expect(result.stdout).toContain("Phase 02");
    expect(result.stdout).toContain("linghun --version");
    expect(result.stdout).toContain("Linghun --version");
    expect(result.stdout).toContain("sessions list");
    expect(result.exitCode).toBe(0);
  });

  it("lists sessions through slash command", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-cli-project-"));
    const previousCwd = process.cwd();

    try {
      process.chdir(project);
      const result = await runCli(["/sessions"]);

      expect(result.stdout).toContain("当前项目还没有会话");
      expect(result.exitCode).toBe(0);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("creates, lists, resumes, and summarizes a session", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-cli-project-"));
    const previousCwd = process.cwd();

    try {
      process.chdir(project);
      const created = await runCli(["sessions", "create", "--message", "你好", "--json"]);
      const session = JSON.parse(created.stdout) as { id: string };

      await runCli(["sessions", "append", session.id, "--message", "第二条"]);
      await runCli(["sessions", "summary", session.id, "--text", "Phase 02 测试会话"]);
      const listed = await runCli(["sessions", "list"]);
      const resumed = await runCli(["sessions", "resume", session.id, "--json"]);
      const summary = await runCli(["/sessions", "summary", session.id]);
      const resumePayload = JSON.parse(resumed.stdout) as { transcript: unknown[] };

      expect(listed.stdout).toContain(session.id);
      expect(listed.stdout).toContain("Phase 02 测试会话");
      expect(resumePayload.transcript).toHaveLength(3);
      expect(summary.stdout).toContain("Phase 02 测试会话");
    } finally {
      process.chdir(previousCwd);
    }
  });
});
