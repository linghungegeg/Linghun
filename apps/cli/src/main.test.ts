import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, getProjectSettingsPath, getProviderEnvPath } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

// 真实运行时默认 DeepSeek 模型（D.13P-hotfix）。配置里 deepseek-v4-flash 已是 placeholder，
// 现役默认为 deepseek-chat（见 packages/config defaultDeepSeekModel）。doctor 解析的是
// config.defaultModel/route，而不是 project-settings 里 providers.deepseek.model 本身。
const DEFAULT_DEEPSEEK_MODEL = defaultConfig.defaultModel;

// CLI doctor/model 测试必须自带隔离，避免读到本机 ~/.linghun/provider.env、全局 settings 或
// shell 里的 provider/model 环境变量。隔离 HOME 维度（LINGHUN_CONFIG_DIR）+ 清空所有会影响
// provider/model 选择的环境变量，并切到独立 cwd（project）后执行回调。
async function withIsolatedCliConfig<T>(
  run: (paths: { home: string; project: string }) => Promise<T>,
): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "linghun-cli-home-"));
  const project = await mkdtemp(join(tmpdir(), "linghun-cli-project-"));
  await mkdir(join(home, ".linghun"), { recursive: true });
  vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
  for (const key of [
    "LINGHUN_OPENAI_BASE_URL",
    "LINGHUN_OPENAI_API_KEY",
    "LINGHUN_OPENAI_MODEL",
    "LINGHUN_OPENAI_ENDPOINT_PROFILE",
    "LINGHUN_DEEPSEEK_BASE_URL",
    "LINGHUN_DEEPSEEK_API_KEY",
    "LINGHUN_DEEPSEEK_MODEL",
    "LINGHUN_DEFAULT_MODEL",
    "LINGHUN_INFERENCE_LEVEL",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
  ]) {
    vi.stubEnv(key, undefined);
  }
  const previousCwd = process.cwd();
  try {
    process.chdir(project);
    return await run({ home, project });
  } finally {
    process.chdir(previousCwd);
  }
}

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
    expect(result.stdout).toContain("TUI /model setup");
    expect(result.stdout).toContain("交互式配置 API 地址、key、模型名称和推理等级");
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
    await withIsolatedCliConfig(async () => {
      const shown = await runCli(["/model"]);
      const switched = await runCli(["/model", "set", "deepseek-reasoner"]);
      const doctor = await runCli(["/model", "doctor"]);

      expect(shown.stdout).toContain("DeepSeek Chat");
      expect(shown.stdout).toContain("上下文窗口：128000");
      expect(shown.stdout).toContain("base_url：present");
      expect(shown.stdout).not.toContain("https://api.deepseek.com");
      expect(switched.stdout).toContain("deepseek-reasoner");
      expect(switched.stdout).toContain("上下文窗口：64000");
      expect(switched.stdout).toContain("厂商最大输出：8192");
      expect(switched.stdout).toContain("请求输出上限：未设置");
      expect(doctor.stdout).toContain("provider=deepseek model=deepseek-reasoner");
      expect(doctor.stdout).toContain("endpointProfile=chat_completions");
      expect(doctor.stdout).toContain("endpointPath=/v1/chat/completions");
      expect(doctor.stdout).toContain("baseUrl=present");
      expect(doctor.stdout).toContain("apiKey=missing");
      expect(doctor.stdout).not.toContain("base_url：");
      expect(doctor.stdout).toContain("缺少 api_key");
      expect(doctor.stdout).toContain("建议：修复后重新运行 /model doctor");
      expect(doctor.exitCode).toBe(0);
    });
  });

  it("normalizes legacy DeepSeek alias in CLI model set and persists the real API model", async () => {
    await withIsolatedCliConfig(async ({ project }) => {
      const switched = await runCli(["model", "set", "deepseek-v4-pro"]);
      const raw = await readFile(getProjectSettingsPath(project), "utf8");

      expect(switched.stdout).toContain("当前 headless 模型已切换为：deepseek-reasoner");
      expect(switched.stdout).toContain("legacy/display alias");
      expect(raw).toContain("deepseek-reasoner");
      expect(raw).not.toContain("deepseek-v4-pro");
      expect(switched.exitCode).toBe(0);
    });
  });

  it("rejects invalid CLI model set without changing persisted settings", async () => {
    await withIsolatedCliConfig(async ({ project }) => {
      await runCli(["model", "set", "deepseek-chat"]);
      const before = await readFile(getProjectSettingsPath(project), "utf8");

      const rejected = await runCli(["model", "set", "invalid-model"]);
      const after = await readFile(getProjectSettingsPath(project), "utf8");

      expect(rejected.exitCode).toBe(2);
      expect(rejected.stderr).toContain("未知模型：invalid-model");
      expect(after).toBe(before);
    });
  });

  it("warns when headless model doctor reads apiKey from project settings", async () => {
    await withIsolatedCliConfig(async ({ project }) => {
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

      const doctor = await runCli(["/model", "doctor"]);

      expect(doctor.stdout).toContain("apiKey=present source=project-settings-legacy");
      expect(doctor.stdout).toContain("masked=sk-…cret");
      expect(doctor.stdout).toContain("WARN: project-settings provider=deepseek contains apiKey");
      expect(doctor.stdout).toContain("环境变量或私有配置");
      // doctor 解析的是 route/defaultModel（真实默认 deepseek-chat），project-settings 里
      // providers.deepseek.model 本身不改变 route defaultModel；这是真实行为，不是测试缺陷。
      expect(doctor.stdout).toContain(`provider=deepseek model=${DEFAULT_DEEPSEEK_MODEL}`);
      expect(doctor.stdout).toContain("endpointProfile=chat_completions");
      expect(doctor.stdout).toContain("endpointPath=/v1/chat/completions");
      expect(doctor.stdout).toContain("baseUrl=present");
      expect(doctor.stdout).not.toContain("base_url：https://api.deepseek.com/v1");
      expect(doctor.stdout).not.toContain("sk-cli-project-secret");
      expect(doctor.stdout).not.toContain(project);
      expect(doctor.exitCode).toBe(0);
    });
  });

  it("shows env source when headless model doctor env apiKey overrides project settings", async () => {
    await withIsolatedCliConfig(async ({ project }) => {
      vi.stubEnv("LINGHUN_DEEPSEEK_API_KEY", "sk-cli-env-secret");
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

      const doctor = await runCli(["/model", "doctor"]);

      expect(doctor.stdout).toContain("apiKey=present source=env");
      expect(doctor.stdout).toContain("masked=sk-…cret");
      expect(doctor.stdout).toContain("WARN: project-settings provider=deepseek contains apiKey");
      // 同上：doctor 报告 route/defaultModel（真实默认 deepseek-chat），不是 settings provider.model。
      expect(doctor.stdout).toContain(`provider=deepseek model=${DEFAULT_DEEPSEEK_MODEL}`);
      expect(doctor.stdout).toContain("endpointProfile=chat_completions");
      expect(doctor.stdout).toContain("endpointPath=/v1/chat/completions");
      expect(doctor.stdout).toContain("baseUrl=present");
      expect(doctor.stdout).not.toContain("base_url：https://api.deepseek.com/v1");
      expect(doctor.stdout).not.toContain("sk-cli-project-overridden-secret");
      expect(doctor.stdout).not.toContain("sk-cli-env-secret");
      expect(doctor.stdout).not.toContain(project);
      expect(doctor.exitCode).toBe(0);
    });
  });

  it("shows provider.env source for headless openai-compatible model doctor", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-cli-home-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-cli-project-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    await mkdir(join(home, ".linghun"), { recursive: true });
    await writeFile(
      getProviderEnvPath(home),
      [
        "LINGHUN_OPENAI_BASE_URL=https://provider.invalid/v1",
        "LINGHUN_OPENAI_API_KEY=sk-cli-provider-secret",
        "LINGHUN_OPENAI_MODEL=provider-cli-model",
        "LINGHUN_INFERENCE_LEVEL=Low",
        "",
      ].join("\n"),
      "utf8",
    );
    const previousCwd = process.cwd();

    try {
      process.chdir(project);
      const doctor = await runCli(["model", "doctor"]);

      expect(doctor.stdout).toContain("provider=openai-compatible model=provider-cli-model");
      expect(doctor.stdout).toContain("apiKey=present source=user-provider-env");
      expect(doctor.stdout).toContain("masked=sk-…cret");
      expect(doctor.stdout).toContain("endpointProfile=chat_completions");
      expect(doctor.stdout).toContain("endpointPath=/v1/chat/completions");
      expect(doctor.stdout).toContain("baseUrl=present");
      expect(doctor.stdout).not.toContain("sk-cli-provider-secret");
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
