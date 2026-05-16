import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { type LinghunConfig, defaultConfig, getSessionRootDir } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { computePromptCacheHitRate } from "@linghun/core";
import { createToolContext } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import {
  type TuiContext,
  createCacheState,
  createIndexState,
  createMcpState,
  createMemoryState,
  handleSlashCommand,
  recordModelUsage,
} from "./index.js";

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}

async function createMockCodebaseMemoryConfig(
  project: string,
  mockDir: string,
  changes: { changed_count?: number; changed_files?: string[] } = { changed_count: 0 },
): Promise<{ config: LinghunConfig; callsPath: string }> {
  const callsPath = join(mockDir, "codebase-memory-calls.jsonl");
  const mockPath = join(mockDir, "codebase-memory-mock.cjs");
  await writeFile(
    mockPath,
    `const fs = require("node:fs");
const tool = process.argv[3];
const input = JSON.parse(process.argv[4] || "{}");
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ tool, input }) + "\\n");
if (tool === "list_projects") {
  console.log(JSON.stringify({ projects: [{ name: "test-project", root_path: ${JSON.stringify(project)} }] }));
} else if (tool === "index_status") {
  console.log(JSON.stringify({ status: "ready", nodes: 2, edges: 1 }));
} else if (tool === "detect_changes") {
  console.log(JSON.stringify(${JSON.stringify(changes)}));
} else if (tool === "index_repository") {
  console.log(JSON.stringify({ ok: true }));
} else {
  console.error("unexpected tool " + tool);
  process.exit(2);
}
`,
    "utf8",
  );
  return {
    callsPath,
    config: {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          ...defaultConfig.mcp.servers,
          "codebase-memory": {
            command: process.execPath,
            args: [mockPath],
          },
        },
      },
    },
  };
}

async function readMockCalls(callsPath: string): Promise<string[]> {
  try {
    return (await readFile(callsPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).tool as string);
  } catch {
    return [];
  }
}

function createTestContext(
  project: string,
  store: SessionStore,
  session: { id: string; model: string; permissionMode: TuiContext["permissionMode"] },
  config: LinghunConfig = defaultConfig,
): TuiContext {
  return {
    store,
    sessionId: session.id,
    model: session.model,
    permissionMode: session.permissionMode,
    projectPath: project,
    tools: createToolContext(project),
    permissions: { rules: [], recentDenied: [] },
    language: "zh-CN",
    config,
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: createCacheState(project),
    mcp: createMcpState(config),
    index: createIndexState(config),
    memory: {
      projectRulesPath: join(project, "LINGHUN.md"),
      projectRulesExists: false,
      projectRulesSummary: "missing",
      projectDir: join(project, ".linghun", "memory"),
      userDir: join(project, ".user-memory"),
      sessionDir: join(project, ".linghun", "memory", "session"),
      candidates: [],
      accepted: [],
    },
    agents: [],
    roleUsage: [],
    routeDecisions: [],
    roleHandoffs: [],
    visionObservations: [],
    imageResults: [],
    interrupt: { type: "idle" },
  };
}

describe("Phase 06 TUI slash commands", () => {
  it("shows help, model, and session list", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/help", context, output);
    await handleSlashCommand("/model", context, output);
    await handleSlashCommand("/sessions", context, output);

    expect(output.text).toContain("/sessions resume <id>");
    expect(output.text).toContain("/resume [id]");
    expect(output.text).toContain("/branch [目的]");
    expect(output.text).toContain("/memory storage");
    expect(output.text).toContain("/memory review");
    expect(output.text).toContain("/memory accept <id>");
    expect(output.text).toContain("/model route");
    expect(output.text).toContain("/model route doctor");
    expect(output.text).toContain("/model route set <role> <model>");
    expect(output.text).toContain("/vision <path>");
    expect(output.text).toContain("/image generate <prompt>");
    expect(output.text).toContain("/agents");
    expect(output.text).toContain("/fork <类型> <任务>");
    expect(output.text).toContain("/cache-log config size <n>");
    expect(output.text).toContain("/cache-log export [path]");
    expect(output.text).toContain("/cache status");
    expect(output.text).toContain("/cache warmup|refresh");
    expect(output.text).toContain("/break-cache status");
    expect(output.text).toContain("/mcp status");
    expect(output.text).toContain("/mcp tools");
    expect(output.text).toContain("/index status");
    expect(output.text).toContain("/index search <query>");
    expect(output.text).toContain("/index architecture");
    expect(output.text).toContain("/usage");
    expect(output.text).toContain("/stats endpoints");
    expect(output.text).toContain("当前模型：deepseek-v4-flash");
    expect(output.text).toContain("cache n/a · index");
    expect(output.text).not.toContain("¥--");
    expect(output.text).toContain(session.id);
  });

  it("resumes a previous session through structured handoff", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const current = await store.create({ model: "deepseek-v4-flash" });
    const previous = await store.create({ model: "deepseek-v4-pro" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, current);

    await handleSlashCommand(`/sessions resume ${previous.id}`, context, output);

    expect(context.sessionId).toBe(previous.id);
    expect(context.model).toBe("deepseek-v4-pro");
    expect(output.text).toContain(`已恢复会话：${previous.id}`);
    expect(output.text).toContain("不会把完整 transcript 塞回上下文");
    expect(output.text).toContain("Resume context package");
  });

  it("handles Phase 11 memory, resume, branch, and cache freshness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/memory", context, output);
    await handleSlashCommand("/memory storage", context, output);
    await handleSlashCommand("/memory candidate 项目长期规则只保存稳定工程事实", context, output);
    const candidateId = context.memory.candidates[0]?.id;
    await handleSlashCommand("/memory review", context, output);
    await handleSlashCommand(`/memory accept ${candidateId}`, context, output);
    await handleSlashCommand("/break-cache status", context, output);
    await handleSlashCommand("/resume", context, output);
    await handleSlashCommand("/branch 试验另一种实现", context, output);

    expect(output.text).toContain("缺少 LINGHUN.md");
    expect(output.text).toContain("Memory storage");
    expect(output.text).toContain("Memory review");
    expect(output.text).toContain("已写入项目级长期记忆");
    expect(output.text).toContain("memoryHash");
    expect(output.text).toContain("changedKeys: memoryHash");
    expect(output.text).toContain("已创建分支会话");
    expect(output.text).toContain("禁止事项");
  });

  it("loads LINGHUN.md stable summary into resume and freshness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "LINGHUN.md"),
      `${"长期稳定项目规则 ".repeat(80)}\n- 不要把完整规则文件塞进 prompt/status。`,
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const loaded = await createMemoryState(defaultConfig, project);
    const context = createTestContext(project, store, session);
    context.memory = loaded;

    await handleSlashCommand("/memory", context, output);
    await handleSlashCommand("/break-cache status", context, output);
    await handleSlashCommand("/resume", context, output);

    expect(loaded.projectRulesExists).toBe(true);
    expect(loaded.projectRulesSummary).toContain("长期稳定项目规则");
    expect(loaded.projectRulesSummary.length).toBeLessThan(700);
    expect(output.text).toContain("projectRulesSummary");
    expect(output.text).toContain("projectRulesHash");
    expect(output.text).toMatch(/changedKeys: .*projectRulesHash/);
    expect(output.text).toContain("projectRules:");
    expect(output.text).not.toContain(
      "长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则",
    );
  });

  it("loads accepted memory from disk and uses it in memory freshness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/memory candidate 项目长期规则只保存稳定工程事实", context, output);
    const candidateId = context.memory.candidates[0]?.id;
    await handleSlashCommand(`/memory accept ${candidateId}`, context, output);

    const loaded = await createMemoryState(defaultConfig, project);
    const reloadedContext = createTestContext(project, store, session);
    reloadedContext.memory = loaded;
    await handleSlashCommand("/memory", reloadedContext, output);
    await handleSlashCommand("/memory review", reloadedContext, output);
    await handleSlashCommand("/break-cache status", reloadedContext, output);

    expect(loaded.accepted).toHaveLength(1);
    expect(loaded.accepted[0]?.summary).toBe("项目长期规则只保存稳定工程事实");
    expect(output.text).toContain("accepted: 1");
    expect(output.text).toContain("项目长期规则只保存稳定工程事实");
    expect(output.text).toContain("memoryHash");
    expect(output.text).toMatch(/changedKeys: .*memoryHash/);
  });

  it("records complete handoff identity and branch parent source", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/branch hardening", context, output);
    const branchId = context.sessionId;
    const resumed = await store.resume(branchId ?? "missing");
    const handoff = resumed.transcript.find((event) => event.type === "handoff_packet");
    const branch = resumed.transcript.find((event) => event.type === "branch_created");

    expect(handoff?.type).toBe("handoff_packet");
    expect(branch?.type).toBe("branch_created");
    expect((handoff as { packet?: { id?: string } }).packet?.id).toBeTruthy();
    expect((handoff as { packet?: { sessionId?: string } }).packet?.sessionId).toBe(branchId);
    expect((handoff as { packet?: { projectPath?: string } }).packet?.projectPath).toBe(project);
    expect((handoff as { packet?: { parentSessionId?: string } }).packet?.parentSessionId).toBe(
      session.id,
    );
    expect((branch as { branch?: { parentSessionId?: string } }).branch?.parentSessionId).toBe(
      session.id,
    );
    expect((branch as { branch?: { sourceSession?: string } }).branch?.sourceSession).toBe(
      session.id,
    );
    expect(output.text).toContain(`来源 session：${session.id}`);
  });

  it("runs Phase 12 agents with trimmed context, transcript, status, and cancel path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/fork explorer inspect cache", context, output);
    await handleSlashCommand("/fork planner plan agent loop", context, output);
    await handleSlashCommand("/fork verifier verify agent loop", context, output);
    await handleSlashCommand("/agents", context, output);
    await handleSlashCommand(`/agents show ${context.agents[0]?.id}`, context, output);
    await handleSlashCommand("/fork explorer cancellable --background", context, output);
    const running = context.agents[0];
    await handleSlashCommand(`/agents cancel ${running?.id}`, context, output);

    const parentTranscript = (await store.resume(session.id)).transcript;
    const agentTranscript = (
      await store.resume(context.agents[1]?.transcriptSessionId ?? "missing")
    ).transcript;

    expect(output.text).toContain("Agent context package (trimmed)");
    expect(output.text).toContain("notIncluded=full transcript/full memory/full index/large logs");
    expect(output.text).toContain("explorer 摘要");
    expect(output.text).toContain("planner 摘要");
    expect(output.text).toContain("verifier 摘要");
    expect(output.text).toContain("Agents:");
    expect(output.text).toContain("transcript:");
    expect(output.text).toContain("已取消；主会话可继续");
    expect(context.agents.filter((agent) => agent.status === "running")).toHaveLength(0);
    expect(context.agents.length).toBe(4);
    expect(parentTranscript.some((event) => event.type === "agent_start")).toBe(true);
    expect(parentTranscript.some((event) => event.type === "agent_end")).toBe(true);
    expect(agentTranscript.some((event) => event.type === "system_event")).toBe(true);
  });

  it("routes Phase 13 roles, handoffs, vision, image, and usage", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/model route", context, output);
    await handleSlashCommand("/model route doctor", context, output);
    await handleSlashCommand("/model route set planner deepseek-v4-pro", context, output);
    await handleSlashCommand("/model route set verifier deepseek-v4-pro", context, output);
    await handleSlashCommand("/fork planner plan route loop", context, output);
    await handleSlashCommand("/fork verifier verify route loop", context, output);
    await handleSlashCommand("/agents", context, output);
    await handleSlashCommand("/review", context, output);
    await handleSlashCommand("/vision screenshot.png", context, output);
    await handleSlashCommand("/model route set vision deepseek-vl", context, output);
    await handleSlashCommand("/vision screenshot.png", context, output);
    await handleSlashCommand("/image generate logo concept", context, output);
    await handleSlashCommand("/model route set image deepseek-image", context, output);
    await handleSlashCommand("/image generate logo concept", context, output);
    await handleSlashCommand("/usage", context, output);
    await handleSlashCommand("/stats", context, output);

    expect(output.text).toContain("Model routes（Phase 13");
    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("已设置 planner role");
    expect(output.text).toContain("已设置 verifier role");
    expect(output.text).toContain("role=planner");
    expect(output.text).toContain("role=verifier");
    expect(output.text).toContain("Role handoff: executor -> reviewer");
    expect(output.text).toContain("vision role 未就绪");
    expect(output.text).toContain("VisionObservation:");
    expect(output.text).toContain("image role 未就绪");
    expect(output.text).toContain("ImageGenerationResult:");
    expect(output.text).toContain("role usage (estimated)");
    expect(output.text).toContain("role/model/provider usage (estimated)");
    expect(context.roleHandoffs.some((handoff) => handoff.to === "reviewer")).toBe(true);
    expect(context.visionObservations).toHaveLength(1);
    expect(context.imageResults).toHaveLength(1);
    expect(context.roleUsage.some((usage) => usage.role === "planner")).toBe(true);
    expect(context.roleUsage.some((usage) => usage.role === "verifier")).toBe(true);
    expect(context.roleUsage.some((usage) => usage.role === "vision")).toBe(true);
    expect(context.roleUsage.some((usage) => usage.role === "image")).toBe(true);
    expect(context.routeDecisions.some((decision) => decision.role === "planner")).toBe(true);
    expect(output.text).toContain("fallbackUsed=");
    expect(output.text).not.toContain("¥--");
  });

  it("shows WARN when primary route is usable but fallback is unavailable", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      modelRoutes: {
        ...defaultConfig.modelRoutes,
        routes: defaultConfig.modelRoutes.routes.map((route) =>
          route.role === "planner"
            ? {
                ...route,
                provider: "deepseek",
                primaryModel: "deepseek-v4-pro",
                fallbackModels: ["gpt-4o"],
              }
            : route,
        ),
      },
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          baseUrl: undefined,
          apiKey: undefined,
          model: "openai-compatible-model",
        },
      },
    };
    const context = createTestContext(project, store, session, config);

    await handleSlashCommand("/model route doctor", context, output);

    expect(output.text).toContain("- planner: WARN");
    expect(output.text).toContain("fallback 不可用 gpt-4o");
    expect(output.text).not.toContain("- planner: BLOCK");
  });

  it("records route decisions and uses fallback when primary route is unavailable", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      modelRoutes: {
        ...defaultConfig.modelRoutes,
        routes: defaultConfig.modelRoutes.routes.map((route) =>
          route.role === "planner"
            ? {
                ...route,
                provider: "openai-compatible",
                primaryModel: "gpt-4o",
                fallbackModels: ["deepseek-v4-pro"],
              }
            : route,
        ),
      },
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          baseUrl: undefined,
          apiKey: undefined,
          model: "openai-compatible-model",
        },
      },
    };
    const context = createTestContext(project, store, session, config);

    await handleSlashCommand("/fork planner test route decision", context, output);
    await handleSlashCommand("/stats", context, output);
    const parentTranscript = (await store.resume(session.id)).transcript;

    expect(context.agents[0]?.model).toBe("deepseek-v4-pro");
    expect(context.routeDecisions[0]?.fallbackUsed).toBe(true);
    expect(context.routeDecisions[0]?.selectedModel).toBe("deepseek-v4-pro");
    expect(parentTranscript.some((event) => event.type === "system_event")).toBe(true);
    expect(output.text).toContain("fallbackUsed=yes");
  });

  it("pauses unavailable routes with repair advice and diagnoses openai-compatible config", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      modelRoutes: {
        ...defaultConfig.modelRoutes,
        routes: defaultConfig.modelRoutes.routes.map((route) =>
          route.role === "vision"
            ? {
                ...route,
                provider: "openai-compatible",
                primaryModel: "gpt-4o",
                fallbackModels: [],
              }
            : route,
        ),
      },
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          baseUrl: undefined,
          apiKey: undefined,
          model: "openai-compatible-model",
        },
      },
    };
    const context = createTestContext(project, store, session, config);

    await handleSlashCommand("/model route doctor", context, output);
    await handleSlashCommand("/vision screenshot.png", context, output);
    await handleSlashCommand("/model route doctor", context, output);

    expect(output.text).toContain("openai-compatible 缺 baseUrl");
    expect(output.text).toContain("openai-compatible 缺 apiKey");
    expect(output.text).toContain("vision role 未就绪");
    expect(output.text).toContain("修复建议");
    expect(output.text).toContain("recent route decisions");
    expect(context.routeDecisions[0]?.stopConditions.length).toBeGreaterThan(0);
    expect(context.visionObservations).toHaveLength(0);
  });

  it("pauses openai-compatible routes when model is still unconfirmed", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      modelRoutes: {
        ...defaultConfig.modelRoutes,
        routes: defaultConfig.modelRoutes.routes.map((route) =>
          route.role === "vision"
            ? {
                ...route,
                provider: "openai-compatible",
                primaryModel: "gpt-4o",
                fallbackModels: [],
              }
            : route,
        ),
      },
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          baseUrl: "https://example.invalid/v1",
          apiKey: "test-key",
          model: "openai-compatible-model",
        },
      },
    };
    const context = createTestContext(project, store, session, config);

    await handleSlashCommand("/vision screenshot.png", context, output);
    await handleSlashCommand("/model route doctor", context, output);

    expect(output.text).toContain("openai-compatible 缺已确认模型");
    expect(output.text).toContain("vision role 未就绪");
    expect(context.routeDecisions[0]?.stopConditions).toContain("openai-compatible 缺已确认模型");
    expect(context.visionObservations).toHaveLength(0);
  });

  it("keeps worker writes behind the permission pipeline", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/mode plan", context, output);
    await handleSlashCommand("/fork worker write agent.txt hello", context, output);
    await handleSlashCommand("/mode default", context, output);
    await handleSlashCommand("/fork worker write agent.txt hello", context, output);

    expect(output.text).toContain("权限管道拒绝写入 agent.txt");
    expect(output.text).toContain("Plan 模式禁止写入");
    expect(output.text).toContain("已通过权限管道执行低风险写入 agent.txt");
    expect(await readFile(join(project, "agent.txt"), "utf8")).toBe("hello");
  });

  it("creates LINGHUN.md only on explicit memory init", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/memory init", context, output);

    expect(output.text).toContain("已生成基础 LINGHUN.md");
    expect(await readFile(join(project, "LINGHUN.md"), "utf8")).toContain("只记录长期稳定工程规则");
  });

  it("enforces plan permissions and records recent denials", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "sample.txt"), "alpha", "utf8");
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/mode plan", context, output);
    await handleSlashCommand("/read sample.txt", context, output);
    await handleSlashCommand("/write sample.txt beta", context, output);
    await handleSlashCommand("/permissions recent", context, output);

    expect(output.text).toContain("已切换权限模式：plan");
    expect(output.text).toContain("工具 Read 结果");
    expect(output.text).toContain("权限已拒绝");
    expect(output.text).toContain("Plan 模式禁止写入");
    expect(await readFile(join(project, "sample.txt"), "utf8")).toBe("alpha");
  });

  it("creates and accepts structured plan proposals", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/plan", context, output);
    await handleSlashCommand("/plan accept a", context, output);

    expect(output.text).toContain("PlanProposal");
    expect(output.text).toContain("方案 a");
    expect(output.text).toContain("已确认计划");
    expect(context.permissionMode).toBe("default");
  });

  it("allows acceptEdits low-risk edits but denies bash and medium writes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "sample.txt"), "alpha", "utf8");
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/mode acceptEdits", context, output);
    await handleSlashCommand("/edit sample.txt alpha => beta", context, output);
    await handleSlashCommand("/write medium.txt should-not-write", context, output);
    await handleSlashCommand("/bash node --version", context, output);

    expect(output.text).toContain("写入前摘要");
    expect(output.text).toContain("工具 Edit 结果");
    expect(output.text).toContain("acceptEdits 不自动允许 Bash");
    expect(output.text).toContain("风险：low");
    expect(await readFile(join(project, "sample.txt"), "utf8")).toBe("beta");
    await expect(readFile(join(project, "medium.txt"), "utf8")).rejects.toThrow();
  });

  it("persists permission rules", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/permissions add deny Bash high", context, output);
    await handleSlashCommand("/permissions", context, output);
    const ruleId = context.permissions.rules[0]?.id;
    await handleSlashCommand(`/permissions remove ${ruleId}`, context, output);

    expect(output.text).toContain("已添加权限规则");
    expect(output.text).toContain("deny  Bash  high");
    expect(output.text).toContain("已删除规则");
  });

  it("records ask rules and deletes recent denials by id", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/permissions add ask Write medium", context, output);
    await handleSlashCommand("/write ask.txt should-not-write", context, output);
    await handleSlashCommand("/permissions recent", context, output);
    const recentId = context.permissions.recentDenied[0]?.id;
    await handleSlashCommand(`/permissions recent delete ${recentId}`, context, output);

    expect(output.text).toContain("命中 ask 规则");
    expect(output.text).toContain("当前最小 REPL 没有交互式审批选择");
    expect(output.text).toContain("Write  default");
    expect(output.text).toContain("已删除最近拒绝");
    expect(context.permissions.recentDenied).toHaveLength(0);
    await expect(readFile(join(project, "ask.txt"), "utf8")).rejects.toThrow();
  });

  it("switches i18n output between zh-CN and en-US", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/help", context, output);
    await handleSlashCommand("/language en-US", context, output);
    await handleSlashCommand("/help", context, output);

    expect(output.text).toContain("可用命令");
    expect(output.text).toContain("Language switched to English.");
    expect(output.text).toContain("Available commands");
    expect(output.text).toContain("Status: session");
  });

  it("creates checkpoints and restores them with rewind", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "sample.txt"), "alpha", "utf8");
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/write sample.txt beta", context, output);
    const checkpointId = context.checkpoints[0]?.id;
    await handleSlashCommand("/rewind", context, output);
    await handleSlashCommand(`/rewind restore ${checkpointId}`, context, output);

    expect(output.text).toContain("已创建 checkpoint");
    expect(output.text).toContain("已恢复 checkpoint");
    expect(await readFile(join(project, "sample.txt"), "utf8")).toBe("alpha");
  });

  it("tracks background task status and empty output state", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/bash node --version", context, output);
    await handleSlashCommand("/background", context, output);

    expect(output.text).toContain("[后台]");
    expect(output.text).toContain("Bash:");
    expect(context.backgroundTasks[0]?.status).toBe("completed");
    expect(context.backgroundTasks[0]?.logPath).toBeTruthy();
  });

  it("blocks code-fact answers without evidence and downgrades unsupported claims", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/claim-check", context, output);
    await handleSlashCommand("/claim-check 已修复并已验证", context, output);

    expect(output.text).toContain("用法：/claim-check <claim>");
    expect(output.text).toContain("缺少证据");
    expect(output.text).toContain("未验证 / 待确认");
  });

  it("keeps /btw isolated from todo, plan, and checkpoints", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/plan", context, output);
    await handleSlashCommand("/todo add 主任务", context, output);
    await handleSlashCommand("/btw 现在是什么阶段？", context, output);

    expect(output.text).toContain("临时插问");
    expect(context.activePlan).toBeTruthy();
    expect(context.tools.todos).toHaveLength(1);
    expect(context.checkpoints).toHaveLength(0);
  });

  it("records interrupt state clearly", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/interrupt", context, output);

    expect(output.text).toContain("状态为 idle");
  });

  it("generates and runs verification plans with transcript evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { smoke: "node -e \"console.log('ok')\"" } }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/verify plan", context, output);
    await handleSlashCommand("/verify", context, output);
    await handleSlashCommand("/verify last", context, output);

    const transcript = (await store.resume(session.id)).transcript;
    expect(output.text).toContain("验证计划");
    expect(output.text).toContain("PASS");
    expect(output.text).toContain("日志：");
    expect(context.lastVerification?.status).toBe("pass");
    expect(context.backgroundTasks[0]?.kind).toBe("verification");
    expect(context.backgroundTasks[0]?.result).toBe("pass");
    expect(transcript.some((event) => event.type === "verification_start")).toBe(true);
    expect(transcript.some((event) => event.type === "verification_end")).toBe(true);
    expect(
      transcript.some((event) => event.type === "evidence_record" && event.kind === "test_result"),
    ).toBe(true);
  });

  it("reports failed verification with log path and next action", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { smoke: 'node -e "process.exit(3)"' } }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/verify", context, output);

    expect(context.lastVerification?.status).toBe("fail");
    expect(output.text).toContain("FAIL");
    expect(output.text).toContain("复跑 /verify");
    expect(output.text).toContain("log:");
    expect(context.lastVerification?.commands[0]?.logPath).toBeTruthy();
  });

  it("classifies Vitest cleanup crashes after passing tests as runner partial", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        scripts: {
          smoke:
            "node -e \"console.log('Test Files  10 passed'); console.log('Tests  48 passed'); console.error('TypeError: emitter.removeListener is not a function'); process.exit(1)\"",
        },
      }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/verify", context, output);
    await handleSlashCommand("/verify last", context, output);
    await handleSlashCommand("/review", context, output);

    expect(context.lastVerification?.status).toBe("partial");
    expect(context.lastVerification?.commands[0]?.status).toBe("partial");
    expect(output.text).toContain("PARTIAL");
    expect(output.text).toContain("runner error");
    expect(output.text).toContain("Node 22 LTS");
    expect(output.text).toContain("log:");
    expect(context.backgroundTasks[0]?.result).toBe("partial");
  });

  it("classifies masked child signals as runner partial", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        scripts: {
          smoke:
            "node -e \"console.log('before signal'); console.error('SIGTERM'); process.exit(1)\"",
        },
      }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/verify", context, output);

    expect(context.lastVerification?.status).toBe("partial");
    expect(context.lastVerification?.commands[0]?.runnerError).toContain("SIGTERM");
    expect(output.text).toContain("runner error");
  });

  it("supports smoke verification, review output, and claim evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/claim-check 已验证", context, output);
    await handleSlashCommand("/verify smoke", context, output);
    await handleSlashCommand("/review", context, output);
    await handleSlashCommand("/claim-check 已验证", context, output);

    expect(output.text).toContain("缺少证据");
    expect(output.text).toContain("Review Report");
    expect(output.text).toContain("Priority");
    expect(output.text).toContain("Suggestion");
    expect(output.text).toContain("Claim Checker：通过");
  });

  it("keeps verification background summaries out of the input area", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    await handleSlashCommand("/verify smoke", context, output);
    await handleSlashCommand("/background", context, output);

    expect(output.text).toContain("[后台]");
    expect(output.text).not.toContain("你> [后台]");
    expect(output.text).not.toContain("you> [background]");
  });

  it("computes cache hit rate without output tokens in denominator", () => {
    expect(
      computePromptCacheHitRate({
        inputTokens: 100,
        outputTokens: 900,
        cacheReadTokens: 50,
        cacheWriteTokens: 50,
        provider: "deepseek",
        model: "deepseek-v4-flash",
      }),
    ).toBe(0.25);
    expect(
      computePromptCacheHitRate({
        inputTokens: 0,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        provider: "deepseek",
        model: "deepseek-v4-flash",
      }),
    ).toBeNull();
  });

  it("records cache usage, classifies write sources, and trims cache history", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    const reported = recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 900,
      totalTokens: 1000,
      cacheReadTokens: 50,
      cacheWriteTokens: 50,
      cacheWriteTokensRaw: 50,
      endpoint: "/v1/messages",
    });
    const zeroReported = recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      cacheWriteTokensRaw: 0,
      endpoint: "/v1/responses",
    });
    const missing = recordModelUsage(context, {
      inputTokens: 10,
      outputTokens: 1,
      totalTokens: 11,
      endpoint: "/v1/chat/completions",
    });
    const estimated = recordModelUsage(context, {
      inputTokens: 10,
      outputTokens: 1,
      totalTokens: 11,
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      cacheWriteTokensEstimated: true,
      endpoint: "/v1/chat/completions",
    });

    expect(reported.cacheWriteTokensSource).toBe("reported");
    expect(zeroReported.cacheWriteTokensSource).toBe("zero_reported");
    expect(missing.cacheWriteTokensSource).toBe("missing");
    expect(estimated.cacheWriteTokensSource).toBe("estimated");
    expect(reported.hitRate).toBe(0.25);

    await handleSlashCommand("/cache-log", context, output);
    await handleSlashCommand("/cache-log config size 2", context, output);
    await handleSlashCommand("/cache-log", context, output);

    expect(context.cache.history).toHaveLength(2);
    expect(context.cache.history[0]?.turn).toBe(3);
    expect(output.text).toContain("Cache log 最近");
    expect(output.text).toContain("write_source=zero_reported");
    expect(output.text).toContain("cache history size：2");
  });

  it("shows cache status, break-cache status, usage, and endpoint stats conservatively", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      cacheWriteTokensRaw: 0,
      endpoint: "/v1/responses",
      rawUsage: { prompt_tokens: 100, cache_creation_tokens: 0 },
    });

    await handleSlashCommand("/cache status", context, output);
    context.model = "deepseek-v4-pro";
    recordModelUsage(context, {
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      cacheReadTokens: 5,
      cacheWriteTokens: 5,
      cacheWriteTokensRaw: 5,
      endpoint: "/v1/messages",
    });
    await handleSlashCommand("/break-cache status", context, output);
    await handleSlashCommand("/usage", context, output);
    await handleSlashCommand("/stats", context, output);
    await handleSlashCommand("/stats endpoints", context, output);
    await handleSlashCommand("/status", context, output);

    expect(output.text).toContain("cache write source");
    expect(output.text).toContain("freshness changedKeys");
    expect(output.text).toContain("modelProviderHash");
    expect(output.text).toContain("/cache warmup");
    expect(output.text).toContain("cache_creation/cache write 为 0");
    expect(output.text).toContain("不代表零写入成本");
    expect(output.text).toContain("任何金额只能标记 estimated");
    expect(output.text).toContain("cost: estimated unavailable");
    expect(output.text).toContain("/v1/responses: samples=1");
    expect(output.text).toContain("/v1/messages: samples=1");
    expect(output.text).not.toContain("零成本");
    expect(output.text).not.toContain("¥");
  });

  it("marks index status stale from detect_changes without refreshing", async () => {
    for (const changes of [{ changed_count: 2 }, { changed_files: ["src/a.ts", "src/b.ts"] }]) {
      const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
      const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
      const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir, changes);
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model: "deepseek-v4-flash" });
      const output = new MemoryOutput();
      const context = createTestContext(project, store, session, config);

      await handleSlashCommand("/index status", context, output);

      expect(output.text).toContain("status: stale");
      expect(output.text).toContain("changedFiles: 2");
      expect(output.text).toContain("detect_changes 发现 2 个变更文件");
      expect(output.text).toContain("不会自动刷新");
      expect(await readMockCalls(callsPath)).toEqual([
        "list_projects",
        "index_status",
        "detect_changes",
      ]);
    }
  });

  it("blocks index commands on unignored generated directories by default", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, "node_modules", "large-package"), { recursive: true });
    await writeFile(
      join(project, "node_modules", "large-package", "big.json"),
      "x".repeat(1_100_000),
      "utf8",
    );
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session, config);

    await handleSlashCommand("/index init fast", context, output);
    await handleSlashCommand("/index refresh", context, output);

    expect(output.text).toContain("索引安全门：/index init fast");
    expect(output.text).toContain("索引安全门：/index refresh");
    expect(output.text).toContain("node_modules/");
    expect(output.text).toContain("generated/dependency directory");
    expect(output.text).toContain(".linghunignore 或 .cbmignore");
    expect(await readMockCalls(callsPath)).toEqual([]);
  });

  it("allows forced index commands to reach the index_repository path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, "dist"), { recursive: true });
    await writeFile(join(project, "dist", "bundle.min.js"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session, config);

    await handleSlashCommand("/index init fast --force", context, output);
    await handleSlashCommand("/index refresh --force", context, output);

    const calls = await readMockCalls(callsPath);
    expect(calls.filter((tool) => tool === "index_repository")).toHaveLength(2);
    expect(output.text).not.toContain("索引前发现未排除的大文件风险");
  });

  it("keeps light hints out of the prompt/input area", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = createTestContext(project, store, session);

    recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      cacheWriteTokensRaw: 0,
    });
    await handleSlashCommand("/cache status", context, output);
    await handleSlashCommand("/status", context, output);

    expect(output.text).not.toContain("你> [hint");
    expect(output.text).not.toContain("you> [hint");
    expect(output.text).not.toContain("¥");
  });
});
