import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemoteInboundMessage, RemoteState } from "./tui-data-types.js";

export class BoundedUUIDSet {
  private readonly order: string[] = [];
  private readonly values = new Set<string>();

  constructor(private readonly limit = 50) {}

  add(value: string): boolean {
    if (!value) return false;
    if (this.values.has(value)) return false;
    this.values.add(value);
    this.order.unshift(value);
    while (this.order.length > this.limit) {
      const dropped = this.order.pop();
      if (dropped) this.values.delete(dropped);
    }
    return true;
  }

  has(value: string): boolean {
    return this.values.has(value);
  }

  snapshot(): string[] {
    return [...this.order];
  }
}

export class FlushGate {
  private open = true;
  private queued = 0;

  begin(): boolean {
    if (!this.open) {
      this.queued += 1;
      return false;
    }
    this.open = false;
    return true;
  }

  end(): void {
    this.open = true;
    this.queued = 0;
  }

  status(): { open: boolean; queued: number } {
    return { open: this.open, queued: this.queued };
  }
}

export type RemoteDedupState = {
  recentPostedUUIDs: BoundedUUIDSet;
  initialMessageUUIDs: BoundedUUIDSet;
  recentInboundUUIDs: BoundedUUIDSet;
  flushGate: FlushGate;
};

export type ReplBridgeMessage =
  | { type: "register"; clientId: string; initialMessageIds?: string[] }
  | { type: "poll"; clientId: string }
  | { type: "acknowledge"; clientId: string; messageId: string }
  | { type: "heartbeat"; clientId: string; now: string }
  | { type: "stop"; clientId: string; reason?: string }
  | { type: "deregister"; clientId: string }
  | { type: "inbound"; clientId: string; text: string; messageId?: string; now?: string };

export type ReplBridgeDecision =
  | { status: "registered"; clientId: string; queued: number }
  | { status: "polled"; clientId: string; messages: RemoteInboundMessage[] }
  | { status: "acknowledged"; clientId: string; messageId: string }
  | { status: "heartbeat"; clientId: string; now: string }
  | { status: "stopped"; clientId: string; reason: string }
  | { status: "deregistered"; clientId: string }
  | { status: "accepted"; clientId: string; message: RemoteInboundMessage }
  | { status: "duplicate"; clientId: string; messageId: string }
  | { status: "blocked"; clientId: string; reason: string };

export type ReplBridgeClient = {
  clientId: string;
  registeredAt: string;
  heartbeatAt: string;
  active: boolean;
  queue: RemoteInboundMessage[];
};

export type ReplBridgeState = {
  clients: ReplBridgeClient[];
  dedup: RemoteDedupState;
};

export type JwtRefreshInput = {
  token?: string;
  expiresAt?: string;
  nowMs?: number;
  refreshBeforeMs?: number;
  refresh: () => Promise<{ token: string; expiresAt: string }>;
};

export type ReplBridgeSocketServer = {
  socketPath: string;
  close: () => Promise<void>;
};

export function createRemoteDedupState(limit = 50): RemoteDedupState {
  return {
    recentPostedUUIDs: new BoundedUUIDSet(limit),
    initialMessageUUIDs: new BoundedUUIDSet(limit),
    recentInboundUUIDs: new BoundedUUIDSet(limit),
    flushGate: new FlushGate(),
  };
}

export function createReplBridgeState(limit = 50): ReplBridgeState {
  return { clients: [], dedup: createRemoteDedupState(limit) };
}

export function createDefaultReplBridgeSocketPath(projectPath: string): string {
  const suffix = createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\linghun-repl-${suffix}`;
  }
  return join(tmpdir(), `linghun-repl-${suffix}.sock`);
}

export async function startReplBridgeSocketServer(input: {
  socketPath: string;
  bridge: () => ReplBridgeState;
  remote: () => RemoteState;
}): Promise<ReplBridgeSocketServer> {
  if (process.platform !== "win32") {
    await rm(input.socketPath, { force: true }).catch(() => undefined);
  }
  const server = createServer((socket) => attachReplBridgeSocket(socket, input.bridge, input.remote));
  await listen(server, input.socketPath);
  return {
    socketPath: input.socketPath,
    close: async () => {
      await closeServer(server);
      if (process.platform !== "win32") {
        await rm(input.socketPath, { force: true }).catch(() => undefined);
      }
    },
  };
}

export async function maybeRefreshJwtToken(
  input: JwtRefreshInput,
): Promise<{ refreshed: false; reason: string } | { refreshed: true; token: string; expiresAt: string }> {
  if (!input.token || !input.expiresAt) {
    return { refreshed: false, reason: "jwt metadata unavailable" };
  }
  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return { refreshed: false, reason: "jwt expiresAt invalid" };
  }
  const refreshBeforeMs = input.refreshBeforeMs ?? 5 * 60 * 1000;
  const nowMs = input.nowMs ?? Date.now();
  if (expiresAtMs - nowMs > refreshBeforeMs) {
    return { refreshed: false, reason: "jwt still fresh" };
  }
  const next = await input.refresh();
  return { refreshed: true, token: next.token, expiresAt: next.expiresAt };
}

export function handleReplBridgeMessage(
  bridge: ReplBridgeState,
  remote: RemoteState,
  message: ReplBridgeMessage,
): ReplBridgeDecision {
  if (!bridge.dedup.flushGate.begin()) {
    return { status: "blocked", clientId: message.clientId, reason: "flush in progress" };
  }
  try {
    return handleReplBridgeMessageInner(bridge, remote, message);
  } finally {
    bridge.dedup.flushGate.end();
  }
}

function attachReplBridgeSocket(
  socket: Socket,
  bridge: () => ReplBridgeState,
  remote: () => RemoteState,
): void {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      socket.write(`${JSON.stringify(handleSocketLine(trimmed, bridge, remote))}\n`);
    }
  });
}

function handleSocketLine(
  line: string,
  bridge: () => ReplBridgeState,
  remote: () => RemoteState,
): ReplBridgeDecision {
  try {
    return handleReplBridgeMessage(bridge(), remote(), JSON.parse(line) as ReplBridgeMessage);
  } catch {
    return { status: "blocked", clientId: "unknown", reason: "invalid JSON bridge message" };
  }
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function handleReplBridgeMessageInner(
  bridge: ReplBridgeState,
  remote: RemoteState,
  message: ReplBridgeMessage,
): ReplBridgeDecision {
  if (message.type === "register") {
    const now = new Date().toISOString();
    const existing = findClient(bridge, message.clientId);
    const client =
      existing ??
      ({
        clientId: message.clientId,
        registeredAt: now,
        heartbeatAt: now,
        active: true,
        queue: [],
      } satisfies ReplBridgeClient);
    client.active = true;
    client.heartbeatAt = now;
    if (!existing) bridge.clients.unshift(client);
    for (const id of message.initialMessageIds ?? []) {
      bridge.dedup.initialMessageUUIDs.add(id);
    }
    return { status: "registered", clientId: message.clientId, queued: client.queue.length };
  }
  const client = findClient(bridge, message.clientId);
  if (message.type === "deregister") {
    bridge.clients = bridge.clients.filter((item) => item.clientId !== message.clientId);
    return { status: "deregistered", clientId: message.clientId };
  }
  if (!client || !client.active) {
    return { status: "blocked", clientId: message.clientId, reason: "client not registered" };
  }
  if (message.type === "poll") {
    const messages = [...client.queue];
    return { status: "polled", clientId: message.clientId, messages };
  }
  if (message.type === "acknowledge") {
    client.queue = client.queue.filter((item) => item.messageId !== message.messageId);
    bridge.dedup.recentPostedUUIDs.add(message.messageId);
    return { status: "acknowledged", clientId: message.clientId, messageId: message.messageId };
  }
  if (message.type === "heartbeat") {
    client.heartbeatAt = message.now;
    return { status: "heartbeat", clientId: message.clientId, now: message.now };
  }
  if (message.type === "stop") {
    client.active = false;
    return { status: "stopped", clientId: message.clientId, reason: message.reason ?? "stopped" };
  }
  const messageId = message.messageId ?? createLocalMessageId(message.clientId, message.text);
  if (
    bridge.dedup.initialMessageUUIDs.has(messageId) ||
    bridge.dedup.recentInboundUUIDs.has(messageId) ||
    remote.processedMessageIds.includes(messageId)
  ) {
    return { status: "duplicate", clientId: message.clientId, messageId };
  }
  bridge.dedup.recentInboundUUIDs.add(messageId);
  const inbound: RemoteInboundMessage = {
    kind: "natural_language_message",
    channel: "local-repl",
    messageId,
    nonce: createHash("sha256").update(messageId).digest("hex").slice(0, 16),
    source: "local-repl",
    bindingUserId: message.clientId,
    expiresAt: new Date(Date.parse(message.now ?? new Date().toISOString()) + 60_000).toISOString(),
    receivedAt: message.now ?? new Date().toISOString(),
    origin: "adapter",
    text: message.text.trim(),
  };
  client.queue.unshift(inbound);
  client.queue = client.queue.slice(0, 20);
  return { status: "accepted", clientId: message.clientId, message: inbound };
}

function findClient(bridge: ReplBridgeState, clientId: string): ReplBridgeClient | undefined {
  return bridge.clients.find((client) => client.clientId === clientId);
}

function createLocalMessageId(clientId: string, text: string): string {
  if (!text.trim()) return `local-repl-${randomUUID().slice(0, 8)}`;
  return `local-repl-${createHash("sha256").update(`${clientId}:${text}`).digest("hex").slice(0, 12)}`;
}
