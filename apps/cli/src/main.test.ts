import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CLI", () => {
  it("prints the version without help text", async () => {
    const result = await runCli(["--version"]);

    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints help for the interactive terminal CLI", async () => {
    const result = await runCli(["--help"]);

    expect(result.stdout).toContain("进入交互式终端");
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
    expect(result.stdout).toContain("普通中英文输入默认进入模型/工具链路");
    expect(result.stdout).not.toContain("普通中英文输入先经 Command Capability Catalog");
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
      expect(doctor.stdout).toContain("provider=deepseek model=deepseek-v4-pro");
      expect(doctor.stdout).toContain("endpointProfile=chat_completions");
      expect(doctor.stdout).toContain("endpointPath=/v1/chat/completions");
      expect(doctor.stdout).toContain("baseUrl=present");
      expect(doctor.stdout).toContain("apiKey=missing");
      expect(doctor.stdout).not.toContain("base_url：");
      expect(doctor.stdout).toContain("缺少 api_key");
      expect(doctor.stdout).toContain("建议：修复后重新运行 /model doctor");
      expect(doctor.exitCode).toBe(0);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("warns when headless model doctor reads apiKey from project settings", async () => {
    vi.stubEnv("LINGHUN_DEEPSEEK_API_KEY", undefined);
    const project = await mkdtemp(join(tmpdir(), "linghun-cli-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        providers: {
          deepseek: {
            type: "deepseek",
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "sk-cli-project-secret",
            model: "deepseek-v4-flash",
          },
        },
      }),
      "utf8",
    );
    const previousCwd = process.cwd();

    try {
      process.chdir(project);
      const doctor = await runCli(["/model", "doctor"]);

      expect(doctor.stdout).toContain("apiKey=present source=project-settings");
      expect(doctor.stdout).toContain("masked=sk-…cret");
      expect(doctor.stdout).toContain("WARN: project-settings provider=deepseek contains apiKey");
      expect(doctor.stdout).toContain("环境变量或私有配置");
      expect(doctor.stdout).toContain("provider=deepseek model=deepseek-v4-flash");
      expect(doctor.stdout).toContain("endpointProfile=chat_completions");
      expect(doctor.stdout).toContain("endpointPath=/v1/chat/completions");
      expect(doctor.stdout).toContain("baseUrl=present");
      expect(doctor.stdout).not.toContain("base_url：https://api.deepseek.com/v1");
      expect(doctor.stdout).not.toContain("sk-cli-project-secret");
      expect(doctor.stdout).not.toContain(project);
      expect(doctor.exitCode).toBe(0);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("shows env source when headless model doctor env apiKey overrides project settings", async () => {
    vi.stubEnv("LINGHUN_DEEPSEEK_API_KEY", "sk-cli-env-secret");
    const project = await mkdtemp(join(tmpdir(), "linghun-cli-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        providers: {
          deepseek: {
            type: "deepseek",
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "sk-cli-project-overridden-secret",
            model: "deepseek-v4-flash",
          },
        },
      }),
      "utf8",
    );
    const previousCwd = process.cwd();

    try {
      process.chdir(project);
      const doctor = await runCli(["/model", "doctor"]);

      expect(doctor.stdout).toContain("apiKey=present source=env");
      expect(doctor.stdout).toContain("masked=sk-…cret");
      expect(doctor.stdout).toContain("WARN: project-settings provider=deepseek contains apiKey");
      expect(doctor.stdout).toContain("provider=deepseek model=deepseek-v4-flash");
      expect(doctor.stdout).toContain("endpointProfile=chat_completions");
      expect(doctor.stdout).toContain("endpointPath=/v1/chat/completions");
      expect(doctor.stdout).toContain("baseUrl=present");
      expect(doctor.stdout).not.toContain("base_url：https://api.deepseek.com/v1");
      expect(doctor.stdout).not.toContain("sk-cli-project-overridden-secret");
      expect(doctor.stdout).not.toContain("sk-cli-env-secret");
      expect(doctor.stdout).not.toContain(project);
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
