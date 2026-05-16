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

  it("prints help for the Phase 15 preflight CLI", async () => {
    const result = await runCli(["--help"]);

    expect(result.stdout).toContain("Phase 15 preflight");
    expect(result.stdout).toContain("linghun --version");
    expect(result.stdout).toContain("Linghun --version");
    expect(result.stdout).toContain("sessions list");
    expect(result.stdout).toContain("model doctor");
    expect(result.stdout).toContain("/model route");
    expect(result.stdout).toContain("/model route doctor");
    expect(result.stdout).toContain("/image generate <prompt>");
    expect(result.stdout).toContain("/skills");
    expect(result.stdout).toContain("/workflows <name>");
    expect(result.stdout).toContain("/plugins doctor");
    expect(result.stdout).toContain("/doctor hooks");
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

  it("shows and diagnoses the current model through slash commands", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-cli-project-"));
    const previousCwd = process.cwd();

    try {
      process.chdir(project);
      const shown = await runCli(["/model"]);
      const switched = await runCli(["/model", "set", "deepseek-v4-pro"]);
      const doctor = await runCli(["/model", "doctor"]);

      expect(shown.stdout).toContain("DeepSeek V4 Flash");
      expect(shown.stdout).toContain("上下文窗口：128000");
      expect(switched.stdout).toContain("deepseek-v4-pro");
      expect(switched.stdout).toContain("上下文窗口：1048576");
      expect(switched.stdout).toContain("最大输出：16384");
      expect(doctor.stdout).toContain("缺少 api_key");
      expect(doctor.stdout).toContain("建议：修复后重新运行 /model doctor");
      expect(doctor.exitCode).toBe(0);
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
