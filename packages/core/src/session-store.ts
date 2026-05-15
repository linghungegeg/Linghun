import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type JsonlDiagnostic, appendJsonl, readJsonl } from "./jsonl.js";
import { identifyProject } from "./project.js";
import {
  type Session,
  type SessionListItem,
  type TranscriptEvent,
  createEmptyCacheSummary,
  createEmptyCostSummary,
} from "./session.js";

export type SessionStoreOptions = {
  sessionRootDir: string;
  projectPath?: string;
  now?: () => Date;
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

export class SessionStore {
  readonly sessionRootDir: string;
  readonly projectPath: string;
  private readonly now: () => Date;

  constructor(options: SessionStoreOptions) {
    this.sessionRootDir = options.sessionRootDir;
    this.projectPath = options.projectPath ?? process.cwd();
    this.now = options.now ?? (() => new Date());
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
    const entries = await safeReadDir(projectDir);
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

  async appendEvent(sessionId: string, event: TranscriptEvent): Promise<void> {
    const project = identifyProject(this.projectPath);
    const session = await this.readMetadata(project.projectId, sessionId);
    if (!session) {
      throw new Error(`未找到会话：${sessionId}`);
    }

    await appendJsonl(session.transcriptPath, event);
    await this.writeMetadata(project.projectId, {
      ...session,
      updatedAt: this.now().toISOString(),
    });
  }

  async updateSummary(sessionId: string, summary: string): Promise<Session> {
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
    try {
      const text = await readFile(this.getMetadataPath(projectId, sessionId), "utf8");
      return JSON.parse(text) as Session;
    } catch {
      return null;
    }
  }

  private async writeMetadata(projectId: string, session: Session): Promise<void> {
    const metadataPath = this.getMetadataPath(projectId, session.id);
    await mkdir(this.getSessionDir(projectId, session.id), { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  }
}

async function safeReadDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
