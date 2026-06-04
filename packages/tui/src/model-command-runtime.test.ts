import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { type LinghunConfig, getProjectSettingsPath, loadConfig } from "@linghun/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TuiContext } from "./index.js";
import { configureModelCommandRuntime, handleModelCommand } from "./model-command-runtime.js";

describe("/model set command", () => {
  let projectPath: string;
  let isolatedHome: string;
  let output: MockWritable;
  let context: TuiContext;

  beforeEach(async () => {
    // Create isolated home directory to avoid ~/.linghun/provider.env contamination
    isolatedHome = await mkdtemp(join(tmpdir(), "model-cmd-home-"));

    // Stub all provider env vars to avoid contamination
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(isolatedHome, ".linghun"));
    vi.stubEnv("LINGHUN_DATA_DIR", join(isolatedHome, ".linghun", "data"));
    vi.stubEnv("LINGHUN_DEEPSEEK_API_KEY", undefined);
    vi.stubEnv("LINGHUN_DEEPSEEK_MODEL", undefined);
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", undefined);
    vi.stubEnv("LINGHUN_OPENAI_MODEL", undefined);
    vi.stubEnv("LINGHUN_OPENAI_BASE_URL", undefined);
    vi.stubEnv("LINGHUN_DEFAULT_MODEL", undefined);

    projectPath = await mkdtemp(join(tmpdir(), "model-cmd-test-"));
    output = new MockWritable();

    // Setup minimal config
    const settingsPath = getProjectSettingsPath(projectPath);
    await mkdir(join(projectPath, ".linghun"), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        defaultModel: "deepseek-chat",
        providers: {
          deepseek: {
            type: "deepseek",
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "sk-test-key",
            model: "deepseek-chat",
          },
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-openai-test",
            model: "gpt-4",
          },
        },
        modelRoutes: {
          defaultModel: "deepseek-chat",
          routes: [
            {
              role: "executor",
              provider: "deepseek",
              primaryModel: "deepseek-chat",
              fallbackModels: [],
              requiredCapabilities: ["text"],
              allowTools: true,
              allowWrite: true,
              allowBash: true,
              requireApprovalBeforeRun: true,
            },
          ],
        },
      }),
      "utf8",
    );

    const config = await loadConfig(projectPath);
    context = {
      projectPath,
      config,
      model: "deepseek-chat",
      language: "zh-CN",
    } as TuiContext;

    configureModelCommandRuntime({
      currentModelText: () => "当前模型",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("sets a valid model and persists to config", async () => {
    await handleModelCommand(["set", "gpt-4"], context, output);

    expect(output.lines).toContain(
      "已设置默认模型为 gpt-4（provider openai-compatible，role executor）",
    );
    expect(context.model).toBe("gpt-4");

    // Verify persistence
    const reloaded = await loadConfig(projectPath);
    const executorRoute = reloaded.modelRoutes.routes.find((r) => r.role === "executor");
    expect(executorRoute?.primaryModel).toBe("gpt-4");
    expect(executorRoute?.provider).toBe("openai-compatible");
  });

  it("rejects an invalid model with clear error", async () => {
    await handleModelCommand(["set", "not-a-real-model"], context, output);

    expect(output.lines.some((line) => line.includes("错误"))).toBe(true);
    expect(output.lines.some((line) => line.includes("not-a-real-model"))).toBe(true);
    expect(context.model).toBe("deepseek-chat");
  });

  it("requires model argument", async () => {
    await handleModelCommand(["set"], context, output);

    expect(output.lines).toContain("用法：/model set <model>");
  });

  it("infers provider for deepseek- prefix models", async () => {
    await handleModelCommand(["set", "deepseek-chat"], context, output);

    expect(output.lines.some((line) => line.includes("deepseek-chat"))).toBe(true);
    expect(context.model).toBe("deepseek-chat");

    const reloaded = await loadConfig(projectPath);
    const executorRoute = reloaded.modelRoutes.routes.find((r) => r.role === "executor");
    expect(executorRoute?.primaryModel).toBe("deepseek-chat");
    expect(executorRoute?.provider).toBe("deepseek");
  });

  it("sets executor route to deepseek-chat and persists it", async () => {
    await handleModelCommand(["route", "set", "executor", "deepseek-chat"], context, output);

    expect(output.lines).toContain("已设置 executor role：provider deepseek model deepseek-chat");
    expect(context.model).toBe("deepseek-chat");

    const reloaded = await loadConfig(projectPath);
    const executorRoute = reloaded.modelRoutes.routes.find((r) => r.role === "executor");
    expect(executorRoute?.primaryModel).toBe("deepseek-chat");
    expect(executorRoute?.provider).toBe("deepseek");
  });

  it("rejects invalid executor route model without persisting", async () => {
    const before = await loadConfig(projectPath);

    await handleModelCommand(["route", "set", "executor", "invalid-model"], context, output);

    expect(output.lines.some((line) => line.includes("错误：未知模型"))).toBe(true);
    expect(context.model).toBe("deepseek-chat");
    const after = await loadConfig(projectPath);
    expect(after.modelRoutes.routes.find((r) => r.role === "executor")).toEqual(
      before.modelRoutes.routes.find((r) => r.role === "executor"),
    );
  });

  it("normalizes legacy DeepSeek alias before route persistence", async () => {
    await handleModelCommand(["route", "set", "executor", "deepseek-v4-flash"], context, output);

    expect(output.lines).toContain("已设置 executor role：provider deepseek model deepseek-chat");
    expect(output.lines.some((line) => line.includes("legacy/display alias"))).toBe(true);
    const reloaded = await loadConfig(projectPath);
    const raw = await readFile(getProjectSettingsPath(projectPath), "utf8");
    expect(reloaded.modelRoutes.routes.find((r) => r.role === "executor")?.primaryModel).toBe(
      "deepseek-chat",
    );
    expect(raw).not.toContain("deepseek-v4-flash");
  });

  it("does not silently no-op on invalid model", async () => {
    const initialModel = context.model;
    await handleModelCommand(["set", "invalid-xyz-model"], context, output);

    expect(output.lines.some((line) => line.includes("错误"))).toBe(true);
    expect(context.model).toBe(initialModel);
  });

  it("updates context.config after successful set", async () => {
    const configBefore = context.config;
    await handleModelCommand(["set", "gpt-4"], context, output);

    expect(context.config).not.toBe(configBefore);
    const executorRoute = context.config.modelRoutes.routes.find((r) => r.role === "executor");
    expect(executorRoute?.primaryModel).toBe("gpt-4");
  });
});

class MockWritable extends Writable {
  lines: string[] = [];

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    const text = chunk.toString();
    this.lines.push(text.replace(/\n$/, ""));
    callback();
  }
}
