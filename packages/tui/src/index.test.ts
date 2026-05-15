import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { getSessionRootDir } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { createToolContext } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import { type TuiContext, handleSlashCommand } from "./index.js";

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}

function createTestContext(
  project: string,
  store: SessionStore,
  session: { id: string; model: string; permissionMode: TuiContext["permissionMode"] },
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
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
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
    expect(output.text).toContain("当前模型：deepseek-v4-flash");
    expect(output.text).toContain("cache -- · index --");
    expect(output.text).not.toContain("¥--");
    expect(output.text).toContain(session.id);
  });

  it("resumes a previous session", async () => {
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
});
