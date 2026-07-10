import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { formatDiagnosticError, isNodeErrorWithCode } from "@linghun/shared";
import { type JsonlDiagnostic, appendJsonl, readJsonl, readJsonlTail } from "./jsonl.js";
import { identifyProject } from "./project.js";
import {
  type Session,
  type SessionListItem,
  type TranscriptEvent,
  createEmptyCacheSummary,
  createEmptyCostSummary,
} from "./session.js";

// D.13O — sessionId 在写入 / 读取路径前必须做静态校验。
// 拒绝：空字符串、超长、`.` / `..`、绝对路径、盘符、slash/backslash 或其他
//       path-sensitive 字符 (`:` `*` `?` `"` `<` `>` `|`、空格、`%`、TAB/CR/LF)。
// 允许：randomUUID() 产物（hex + `-`）以及不含上述危险字符的紧凑标识符。
//       UUID 含 `-`，所以不能用范围 `[ -/]`（那是 0x20..0x2F 会误伤 0x2D）。
// 错误信息保守、可操作；不写到 fs。
const MAX_SESSION_ID_LENGTH = 128;
const SESSION_ID_INVALID_CHAR = /[\\/\t\r\n :*?"<>|%]/u;

export function assertValidSessionId(sessionId: unknown): asserts sessionId is string {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("sessionId 不能为空。建议：传入由 SessionStore.create 返回的会话 id。");
  }
  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new Error(
      `sessionId 长度超限（>${MAX_SESSION_ID_LENGTH}）。建议：使用 randomUUID 或最近一次 /sessions list 的 id。`,
    );
  }
  if (sessionId === "." || sessionId === "..") {
    throw new Error("sessionId 不能是 . 或 ..；这是路径越界尝试。");
  }
  if (sessionId.includes("..")) {
    throw new Error("sessionId 不允许包含 ..；这是路径越界尝试。");
  }
  if (SESSION_ID_INVALID_CHAR.test(sessionId)) {
    throw new Error(
      'sessionId 含非法字符（slash / backslash / 控制字符 / 空格 / : * ? " < > | %）；不允许进入 sessions 目录。',
    );
  }
  if (isAbsolute(sessionId) || /^[A-Za-z]:/u.test(sessionId)) {
    throw new Error("sessionId 不能是绝对路径或盘符；只允许 sessions 子目录名。");
  }
}

export type SessionStoreOptions = {
  sessionRootDir: string;
  projectPath?: string;
  now?: () => Date;
  runtimeLedgerPathForTest?: (sessionDir: string) => string;
};

export type CreateSessionInput = {
  model?: string;
  summary?: string;
};

export type ResumeSessionResult = {
  session: Session;
  transcript: TranscriptEvent[];
  diagnostics: JsonlDiagnostic[];
};

export type ReadRecentTranscriptEventsInput = {
  limit: number;
  predicate?: (event: TranscriptEvent) => boolean;
};

export class SessionStore {
  readonly sessionRootDir: string;
  readonly projectPath: string;
  private readonly now: () => Date;
  private readonly runtimeLedgerPathForTest?: (sessionDir: string) => string;
  private readonly sessionWriteQueues = new Map<string, Promise<void>>();

  constructor(options: SessionStoreOptions) {
    this.sessionRootDir = options.sessionRootDir;
    this.projectPath = options.projectPath ?? process.cwd();
    this.now = options.now ?? (() => new Date());
    this.runtimeLedgerPathForTest = options.runtimeLedgerPathForTest;
  }

  async create(input: CreateSessionInput = {}): Promise<Session> {
    const project = identifyProject(this.projectPath);
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    const sessionDir = this.getSessionDir(project.projectId, id);
    const transcriptPath = join(sessionDir, "transcript.jsonl");
    const session: Session = {
      id,
      projectPath: project.projectPath,
      projectName: project.projectName,
      createdAt,
      updatedAt: createdAt,
      model: input.model ?? "not-configured",
      permissionMode: "default",
      language: "zh-CN",
      transcriptPath,
      summary: input.summary,
      cost: createEmptyCostSummary(),
      cache: createEmptyCacheSummary(),
    };

    await mkdir(sessionDir, { recursive: true });
    await this.writeMetadata(project.projectId, session);
    await appendJsonl(transcriptPath, {
      type: "session_start",
      sessionId: id,
      projectPath: project.projectPath,
      createdAt,
    } satisfies TranscriptEvent);

    return session;
  }

  async list(): Promise<SessionListItem[]> {
    const project = identifyProject(this.projectPath);
    const projectDir = this.getProjectDir(project.projectId);
    const entries = await safeReadDir(projectDir, "session project directory");
    const sessions = await Promise.all(
      entries.map(async (entry) => this.readMetadata(project.projectId, entry)),
    );

    return sessions
      .filter((session): session is Session => session !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => ({
        id: session.id,
        projectName: session.projectName,
        projectPath: session.projectPath,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        summary: session.summary,
        transcriptPath: session.transcriptPath,
      }));
  }

  async resume(sessionId: string): Promise<ResumeSessionResult> {
    assertValidSessionId(sessionId);
    const project = identifyProject(this.projectPath);
    const session = await this.readMetadata(project.projectId, sessionId);
    if (!session) {
      throw new Error(`未找到会话：${sessionId}`);
    }

    const transcript = await readJsonl<TranscriptEvent>(session.transcriptPath);
    return {
      session,
      transcript: transcript.records,
      diagnostics: transcript.diagnostics,
    };
  }

  async readRecentTranscriptEvents(
    sessionId: string,
    input: ReadRecentTranscriptEventsInput,
  ): Promise<{ events: TranscriptEvent[]; diagnostics: JsonlDiagnostic[] }> {
    assertValidSessionId(sessionId);
    const project = identifyProject(this.projectPath);
    const session = await this.readMetadata(project.projectId, sessionId);
    if (!session) {
      throw new Error(`未找到会话：${sessionId}`);
    }

    const transcript = await readJsonlTail<TranscriptEvent>(session.transcriptPath, {
      limit: input.limit,
      predicate: input.predicate,
    });
    return {
      events: transcript.records,
      diagnostics: transcript.diagnostics,
    };
  }

  async appendEvent(
    sessionId: string,
    event: TranscriptEvent,
    commitGuard?: () => boolean,
  ): Promise<void> {
    assertValidSessionId(sessionId);
    const project = identifyProject(this.projectPath);
    await this.enqueueSessionWrite(project.projectId, sessionId, async () => {
      if (commitGuard && !commitGuard()) return;
      const session = await this.readMetadata(project.projectId, sessionId);
      if (!session) {
        throw new Error(`未找到会话：${sessionId}`);
      }

      if (commitGuard && !commitGuard()) return;
      await appendJsonl(session.transcriptPath, event);
      await this.appendRuntimeLedgerBestEffort(
        this.getSessionDir(project.projectId, sessionId),
        sessionId,
        event,
      );
      await this.writeMetadata(project.projectId, {
        ...session,
        updatedAt: this.now().toISOString(),
      });
    });
  }

  async updateSummary(sessionId: string, summary: string): Promise<Session> {
    assertValidSessionId(sessionId);
    const project = identifyProject(this.projectPath);
    const session = await this.readMetadata(project.projectId, sessionId);
    if (!session) {
      throw new Error(`未找到会话：${sessionId}`);
    }

    const updated = {
      ...session,
      summary,
      updatedAt: this.now().toISOString(),
    };
    await this.writeMetadata(project.projectId, updated);
    return updated;
  }

  async delete(sessionId: string): Promise<void> {
    assertValidSessionId(sessionId);
    const project = identifyProject(this.projectPath);
    const dir = this.getSessionDir(project.projectId, sessionId);
    try {
      await rm(dir, { recursive: true });
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) throw error;
    }
  }

  async prune(maxSessions: number): Promise<number> {
    const all = await this.list();
    if (all.length <= maxSessions) return 0;
    const toDelete = all.slice(maxSessions);
    for (const s of toDelete) {
      try {
        await this.delete(s.id);
      } catch {
        /* best-effort */
      }
    }
    return toDelete.length;
  }

  private getProjectDir(projectId: string): string {
    return join(this.sessionRootDir, projectId);
  }

  private getSessionDir(projectId: string, sessionId: string): string {
    return join(this.getProjectDir(projectId), sessionId);
  }

  private getMetadataPath(projectId: string, sessionId: string): string {
    return join(this.getSessionDir(projectId, sessionId), "session.json");
  }

  private async readMetadata(projectId: string, sessionId: string): Promise<Session | null> {
    const metadataPath = this.getMetadataPath(projectId, sessionId);
    try {
      const text = await readFile(metadataPath, "utf8");
      return JSON.parse(text) as Session;
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return null;
      }
      await this.appendMetadataReadWarning(projectId, sessionId, metadataPath, error);
      return null;
    }
  }

  private async appendMetadataReadWarning(
    projectId: string,
    sessionId: string,
    metadataPath: string,
    error: unknown,
  ): Promise<void> {
    const transcriptPath = join(this.getSessionDir(projectId, sessionId), "transcript.jsonl");
    const message = `session_metadata_read_failed path=${metadataPath} reason=${formatDiagnosticError(error)}`;
    try {
      await appendJsonl(transcriptPath, {
        type: "system_event",
        id: randomUUID(),
        level: "warning",
        message,
        createdAt: this.now().toISOString(),
      } satisfies TranscriptEvent);
    } catch (writeError) {
      process.stderr.write(
        `[linghun] ${message}; warning_write_failed=${formatDiagnosticError(writeError)}\n`,
      );
    }
  }

  private async writeMetadata(projectId: string, session: Session): Promise<void> {
    const metadataPath = this.getMetadataPath(projectId, session.id);
    await mkdir(this.getSessionDir(projectId, session.id), { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  }

  private async appendRuntimeLedgerBestEffort(
    sessionDir: string,
    sessionId: string,
    event: TranscriptEvent,
  ): Promise<void> {
    try {
      await appendRuntimeLedgerForTranscriptEvent(
        this.runtimeLedgerPathForTest?.(sessionDir) ?? join(sessionDir, "runtime-ledger.jsonl"),
        sessionId,
        event,
        this.now().toISOString(),
      );
    } catch (error) {
      process.stderr.write(
        `[linghun] runtime_ledger_write_failed session=${sessionId} reason=${formatDiagnosticError(error)}\n`,
      );
    }
  }

  private enqueueSessionWrite(
    projectId: string,
    sessionId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const key = `${projectId}/${sessionId}`;
    const previous = this.sessionWriteQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const queued = next
      .catch(() => undefined)
      .finally(() => {
        if (this.sessionWriteQueues.get(key) === queued) {
          this.sessionWriteQueues.delete(key);
        }
      });
    this.sessionWriteQueues.set(key, queued);
    return next;
  }
}

async function safeReadDir(dir: string, label: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }
    process.stderr.write(
      `[linghun] readdir_failed label=${label} path=${dir} reason=${formatDiagnosticError(error)}\n`,
    );
    return [];
  }
}

type RuntimeLedgerRecord = {
  id: string;
  sessionId: string;
  kind:
    | "evidence_recorded"
    | "artifact_created"
    | "verification_recorded"
    | "background_updated"
    | "job_updated"
    | "agent_updated"
    | "workflow_updated";
  createdAt: string;
  status?: string;
  evidenceId?: string;
  evidenceKind?: string;
  agentId?: string;
  workflowId?: string;
  jobId?: string;
  backgroundId?: string;
  verificationId?: string;
  artifactPath?: string;
  source?: string;
  summary?: string;
};

async function appendRuntimeLedgerForTranscriptEvent(
  ledgerPath: string,
  sessionId: string,
  event: TranscriptEvent,
  fallbackCreatedAt: string,
): Promise<void> {
  const record = createRuntimeLedgerRecord(sessionId, event, fallbackCreatedAt);
  if (!record) return;
  await appendJsonl(ledgerPath, record);
}

function createRuntimeLedgerRecord(
  sessionId: string,
  event: TranscriptEvent,
  fallbackCreatedAt: string,
): RuntimeLedgerRecord | undefined {
  const createdAt = "createdAt" in event && typeof event.createdAt === "string"
    ? event.createdAt
    : fallbackCreatedAt;
  if (event.type === "verification_start") {
    return {
      id: randomUUID(),
      sessionId,
      kind: "verification_recorded",
      createdAt,
      status: "started",
      verificationId: event.run.id,
      summary: `verification started with ${event.run.plan.length} command(s)`,
    };
  }
  if (event.type === "evidence_record") {
    const record = event as TranscriptEvent & Record<string, unknown>;
    return {
      id: randomUUID(),
      sessionId,
      kind: "evidence_recorded",
      createdAt,
      evidenceId: event.id,
      evidenceKind: event.kind,
      artifactPath: readString(record, "fullOutputPath") ?? readString(record, "outputPath") ??
        readString(record, "logPath") ?? (looksLikeArtifactPath(event.source) ? event.source : undefined),
      source: event.source,
      summary: event.summary,
    };
  }
  if (event.type === "verification_end") {
    return {
      id: randomUUID(),
      sessionId,
      kind: "verification_recorded",
      createdAt,
      status: event.report.status,
      verificationId: event.report.id,
      artifactPath: event.report.logPath,
      summary: event.report.summary,
    };
  }
  if (event.type === "background_task_update") {
    const task = event.task;
    const kind = task.kind === "job" ? "job_updated" : "background_updated";
    return {
      id: randomUUID(),
      sessionId,
      kind,
      createdAt,
      status: task.status,
      backgroundId: task.id,
      ...(task.kind === "job" ? { jobId: task.id } : {}),
      ...(task.kind === "agent" ? { agentId: task.id } : {}),
      artifactPath: task.outputPath ?? task.logPath,
      source: task.kind,
      summary: task.userVisibleSummary || task.title,
    };
  }
  if (event.type === "agent_start") {
    const agent = readRecord(event.agent);
    return {
      id: randomUUID(),
      sessionId,
      kind: "agent_updated",
      createdAt,
      status: "started",
      agentId: readString(agent, "id"),
      summary: readString(agent, "summary") ?? readString(agent, "goal") ?? "agent started",
    };
  }
  if (event.type === "agent_end") {
    return {
      id: randomUUID(),
      sessionId,
      kind: "agent_updated",
      createdAt,
      status: event.status,
      agentId: event.agentId,
      summary: event.summary,
    };
  }
  if (event.type === "workflow_start") {
    const workflow = readRecord(event.workflow);
    return {
      id: randomUUID(),
      sessionId,
      kind: "workflow_updated",
      createdAt,
      status: "started",
      workflowId: readString(workflow, "id"),
      summary: readString(workflow, "summary") ?? readString(workflow, "name") ?? "workflow started",
    };
  }
  if (event.type === "workflow_step_start") {
    return {
      id: randomUUID(),
      sessionId,
      kind: "workflow_updated",
      createdAt,
      status: "step_started",
      workflowId: event.workflowId,
      summary: "workflow step started",
    };
  }
  if (event.type === "workflow_step_result") {
    return {
      id: randomUUID(),
      sessionId,
      kind: "workflow_updated",
      createdAt,
      status: event.status,
      workflowId: event.workflowId,
      summary: event.summary,
    };
  }
  if (event.type === "workflow_end") {
    return {
      id: randomUUID(),
      sessionId,
      kind: "workflow_updated",
      createdAt,
      status: event.status,
      workflowId: event.workflowId,
      summary: event.summary,
    };
  }
  if (event.type === "tool_call_end" && event.output.fullOutputPath) {
    return {
      id: randomUUID(),
      sessionId,
      kind: "artifact_created",
      createdAt,
      artifactPath: event.output.fullOutputPath,
      source: "tool_call_end",
      summary: "tool output artifact recorded",
    };
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function looksLikeArtifactPath(value: string): boolean {
  return /[\\/]/u.test(value) || /\.[a-z0-9]{1,12}$/iu.test(value);
}
