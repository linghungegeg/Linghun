import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlags,
  isFeatureEnabled,
} from "./feature-flag-runtime.js";
import {
  DEFAULT_KEYBINDINGS,
  loadProjectKeybindings,
  mergeKeybindings,
  resolveKeybinding,
} from "./keybinding-runtime.js";
import {
  MAX_MEMORY_CHARACTER_COUNT,
  loadMemoryRulesFile,
  parseMemoryRuleFrontmatter,
  shouldApplyMemoryRule,
} from "./memory-rules-runtime.js";
import {
  BoundedUUIDSet,
  createReplBridgeState,
  handleReplBridgeMessage,
  maybeRefreshJwtToken,
  startReplBridgeSocketServer,
  type ReplBridgeDecision,
  type ReplBridgeMessage,
} from "./remote-repl-bridge-runtime.js";
import { handleRemoteInboundMessage } from "./model-stream-runtime.js";
import { configureRemoteCommandRuntime, handleRemoteCommand } from "./remote-command-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { createMemoryState, createRemoteState } from "./tui-state-runtime.js";

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}

function createPhaseGTuiContext(): TuiContext {
  return {
    config: defaultConfig,
    language: "zh-CN",
    sessionId: "session-phase-g",
    sessionStoreVerifiedId: "session-phase-g",
    store: {
      appendEvent: async () => undefined,
      resume: async () => ({ transcript: [] }),
      create: async () => ({ id: "session-phase-g" }),
    },
    projectPath: "F:\\Linghun",
    remote: createRemoteState(defaultConfig),
  } as unknown as TuiContext;
}

async function withBridgeSocket<T>(
  socketPath: string,
  run: (send: (message: ReplBridgeMessage) => Promise<ReplBridgeDecision>) => Promise<T>,
): Promise<T> {
  const socket = createConnection(socketPath);
  socket.setEncoding("utf8");
  const pending: Array<(decision: ReplBridgeDecision) => void> = [];
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const resolve = pending.shift();
      if (resolve) resolve(JSON.parse(line) as ReplBridgeDecision);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  try {
    return await run(
      (message) =>
        new Promise<ReplBridgeDecision>((resolve) => {
          pending.push(resolve);
          socket.write(`${JSON.stringify(message)}\n`);
        }),
    );
  } finally {
    socket.end();
  }
}

describe("Phase G remote REPL bridge, dedupe, and JWT refresh", () => {
  it("keeps bounded UUID dedupe and rejects duplicate local REPL inbound messages", () => {
    const ids = new BoundedUUIDSet(2);
    expect(ids.add("a")).toBe(true);
    expect(ids.add("a")).toBe(false);
    expect(ids.add("b")).toBe(true);
    expect(ids.add("c")).toBe(true);
    expect(ids.has("a")).toBe(false);

    const remote = createRemoteState(defaultConfig);
    const bridge = createReplBridgeState(5);
    expect(handleReplBridgeMessage(bridge, remote, { type: "register", clientId: "dev" })).toMatchObject({
      status: "registered",
    });
    const accepted = handleReplBridgeMessage(bridge, remote, {
      type: "inbound",
      clientId: "dev",
      text: "hello",
      messageId: "msg-1",
    });
    expect(accepted).toMatchObject({ status: "accepted" });
    expect(
      handleReplBridgeMessage(bridge, remote, {
        type: "inbound",
        clientId: "dev",
        text: "hello again",
        messageId: "msg-1",
      }),
    ).toMatchObject({ status: "duplicate" });
    expect(handleReplBridgeMessage(bridge, remote, { type: "poll", clientId: "dev" })).toMatchObject({
      status: "polled",
      messages: [expect.objectContaining({ messageId: "msg-1" })],
    });
    expect(handleReplBridgeMessage(bridge, remote, { type: "acknowledge", clientId: "dev", messageId: "msg-1" })).toMatchObject({
      status: "acknowledged",
    });
  });

  it("refreshes JWT only inside the refresh window", async () => {
    const fresh = await maybeRefreshJwtToken({
      token: "t",
      expiresAt: new Date(10_000_000).toISOString(),
      nowMs: 1_000,
      refresh: async () => {
        throw new Error("should not refresh");
      },
    });
    expect(fresh).toMatchObject({ refreshed: false, reason: "jwt still fresh" });

    const refreshed = await maybeRefreshJwtToken({
      token: "t",
      expiresAt: new Date(2_000).toISOString(),
      nowMs: 1_000,
      refreshBeforeMs: 5_000,
      refresh: async () => ({ token: "next", expiresAt: new Date(20_000).toISOString() }),
    });
    expect(refreshed).toMatchObject({ refreshed: true, token: "next" });
  });

  it("routes local REPL bridge messages through the existing remote inbound handler", async () => {
    const context = createPhaseGTuiContext();
    const output = new MemoryOutput();
    configureRemoteCommandRuntime({
      appendSystemEvent: async () => undefined,
      ensureSession: async () => "session-phase-g",
      handleRemoteInboundMessage,
    });

    await handleRemoteCommand(["bridge", "local-register", "dev"], context, output);
    await handleRemoteCommand(["bridge", "local-inbound", "dev", "route me"], context, output);
    await handleRemoteCommand(["bridge", "local-route", "dev"], context, output);

    expect(context.remote.processedMessageIds).toHaveLength(1);
    expect(output.text).toContain("no second executor");
    const poll = handleReplBridgeMessage(context.remote.localReplBridge!, context.remote, {
      type: "poll",
      clientId: "dev",
    });
    expect(poll).toMatchObject({ status: "polled", messages: [] });
    await handleRemoteCommand(["bridge", "local-heartbeat", "dev"], context, output);
    expect(context.remote.localReplBridge?.clients[0]?.active).toBe(true);
    await handleRemoteCommand(["bridge", "local-stop", "dev"], context, output);
    expect(context.remote.localReplBridge?.clients[0]?.active).toBe(false);
    await handleRemoteCommand(["bridge", "local-deregister", "dev"], context, output);
    expect(context.remote.localReplBridge?.clients).toHaveLength(0);
  });

  it("serves the local REPL bridge protocol over a real local socket", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-phase-g-repl-project-"));
    const socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\linghun-phase-g-${Date.now()}`
        : join(project, "linghun-repl.sock");
    const remote = createRemoteState(defaultConfig);
    const bridge = createReplBridgeState(5);
    const server = await startReplBridgeSocketServer({
      socketPath,
      bridge: () => bridge,
      remote: () => remote,
    });
    try {
      await withBridgeSocket(server.socketPath, async (send) => {
        expect(await send({ type: "register", clientId: "socket-client" })).toMatchObject({
          status: "registered",
        });
        expect(
          await send({
            type: "inbound",
            clientId: "socket-client",
            text: "from socket",
            messageId: "socket-message-1",
          }),
        ).toMatchObject({ status: "accepted" });
        expect(await send({ type: "poll", clientId: "socket-client" })).toMatchObject({
          status: "polled",
          messages: [expect.objectContaining({ messageId: "socket-message-1" })],
        });
        expect(
          await send({
            type: "acknowledge",
            clientId: "socket-client",
            messageId: "socket-message-1",
          }),
        ).toMatchObject({ status: "acknowledged" });
        expect(
          await send({ type: "heartbeat", clientId: "socket-client", now: new Date().toISOString() }),
        ).toMatchObject({ status: "heartbeat" });
        expect(await send({ type: "stop", clientId: "socket-client" })).toMatchObject({
          status: "stopped",
        });
        expect(await send({ type: "deregister", clientId: "socket-client" })).toMatchObject({
          status: "deregistered",
        });
      });
      expect(bridge.clients).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});

describe("Phase G feature flags and deferred gating", () => {
  it("keeps risky experimental execution disabled by default", () => {
    expect(DEFAULT_FEATURE_FLAGS.experimentalDeferredPluginExecution).toBe(false);
    expect(isFeatureEnabled("localReplBridge", { config: defaultConfig })).toBe(true);
    expect(
      getFeatureFlags({
        config: {
          ...defaultConfig,
          features: { experimentalDeferredSkillExecution: true },
        } as typeof defaultConfig & { features: { experimentalDeferredSkillExecution: boolean } },
      }),
    ).toMatchObject({ experimentalDeferredSkillExecution: true });
  });
});

describe("Phase G memory include/frontmatter/bounds", () => {
  it("loads @include recursively, parses paths frontmatter, and records truncation", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-phase-g-memory-"));
    await writeFile(join(project, "child.md"), "child rule\n", "utf8");
    await writeFile(
      join(project, "LINGHUN.md"),
      ["---", "paths: [\"src/**/*.ts\"]", "---", "root rule", "@include child.md"].join("\n"),
      "utf8",
    );

    const loaded = await loadMemoryRulesFile(join(project, "LINGHUN.md"));
    expect(loaded.content).toContain("root rule");
    expect(loaded.content).toContain("child rule");
    expect(parseMemoryRuleFrontmatter(loaded.content).paths).toEqual(["src/**/*.ts"]);
    expect(shouldApplyMemoryRule(["src/**/*.ts"], ["src/app.ts"])).toBe(true);

    const state = await createMemoryState(defaultConfig, project);
    expect(state.projectRulesSummary).toContain("root rule");
    expect(state.projectRulesIncludedPaths?.length).toBe(2);

    await writeFile(join(project, "LINGHUN.md"), "x".repeat(MAX_MEMORY_CHARACTER_COUNT + 100), "utf8");
    const truncated = await loadMemoryRulesFile(join(project, "LINGHUN.md"));
    expect(truncated.truncated).toBe(true);
    expect(truncated.content.length).toBeLessThanOrEqual(MAX_MEMORY_CHARACTER_COUNT + 1);
  });
});

describe("Phase G keybinding engine", () => {
  it("resolves default bindings, custom overrides, and chords", async () => {
    expect(
      resolveKeybinding(DEFAULT_KEYBINDINGS, "chat", { input: "o", ctrl: true }),
    ).toMatchObject({ action: "toggle-details", pending: false });

    const custom = mergeKeybindings(DEFAULT_KEYBINDINGS, [
      { context: "chat", keys: ["ctrl+x", "ctrl+k"], action: "clear-line" },
    ]);
    const first = resolveKeybinding(custom, "chat", { input: "x", ctrl: true });
    expect(first).toMatchObject({ pending: true });
    expect(
      resolveKeybinding(custom, "chat", { input: "k", ctrl: true }, first.chordBuffer),
    ).toMatchObject({ action: "clear-line" });

    const project = await mkdtemp(join(tmpdir(), "linghun-phase-g-keys-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "keybindings.json"),
      JSON.stringify([
        { context: "global", keys: ["ctrl+x", "ctrl+o"], action: "toggle-details" },
      ]),
      "utf8",
    );
    const loaded = await loadProjectKeybindings(project);
    const chord = resolveKeybinding(loaded, "chat", { input: "x", ctrl: true });
    expect(chord.pending).toBe(true);
    expect(resolveKeybinding(loaded, "chat", { input: "o", ctrl: true }, chord.chordBuffer)).toMatchObject({
      action: "toggle-details",
    });
  });

  it("does not treat empty special-key input as a pending chord", () => {
    expect(resolveKeybinding(DEFAULT_KEYBINDINGS, "chat", { input: "", delete: true })).toEqual({
      chordBuffer: [],
      pending: false,
    });
  });

  it("does not map Shift+Enter or Meta+Enter to the default submit binding", () => {
    expect(
      resolveKeybinding(DEFAULT_KEYBINDINGS, "chat", {
        input: "",
        return: true,
        shift: true,
      }),
    ).toEqual({ chordBuffer: [], pending: false });
    expect(
      resolveKeybinding(DEFAULT_KEYBINDINGS, "chat", {
        input: "",
        return: true,
        meta: true,
      }),
    ).toEqual({ chordBuffer: [], pending: false });
  });
});
