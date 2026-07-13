import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ModelMessage } from "@linghun/providers";
import { redactCommonSecrets } from "@linghun/shared";
import type { TuiContext } from "./index.js";
import { isMemoryTombstoned } from "./memory-tombstone-runtime.js";
import {
  sanitizeDiagnosticText,
  sanitizeDisplayPaths,
  truncateDisplay,
} from "./startup-runtime.js";
import type { MemoryCandidate } from "./tui-data-types.js";

const RESTORE_FILE_LIMIT = 5;
const RESTORE_FILE_MAX_CHARS = 5_000;
const RESTORE_TOTAL_MAX_CHARS = 30_000;
const RESTORE_PLAN_MAX_CHARS = 4_000;
const RESTORE_STATUS_MAX_CHARS = 4_000;
const RESTORE_MEMORY_LIMIT = 4;
const RESTORE_MEMORY_ITEM_MAX_CHARS = 160;

export type CompactRestoreFile = {
  path: string;
  content: string;
  truncated: boolean;
};

export type CompactRestorePayload = {
  files: CompactRestoreFile[];
  plan?: string;
  runtimeStatus: string[];
  userConstraints: string[];
};

export async function buildPostCompactRestoreMessage(
  context: TuiContext,
): Promise<ModelMessage | undefined> {
  const deepCompactId = context.cache.deepCompact?.id;
  const compactProjectionBoundaryId = context.cache.compactProjection?.boundaryId;
  const restoreLatch = context.cache.postCompactRestoreLatch;
  if (
    deepCompactId &&
    restoreLatch?.deepCompactId === deepCompactId &&
    restoreLatch.compactProjectionBoundaryId === compactProjectionBoundaryId
  ) {
    const content = restoreLatch.content;
    return content ? { role: "user", content } : undefined;
  }
  const payload = await buildPostCompactRestorePayload(context);
  const content = formatPostCompactRestorePayload(payload);
  if (deepCompactId) {
    context.cache.postCompactRestoreLatch = {
      deepCompactId,
      compactProjectionBoundaryId,
      content: content ?? null,
    };
  }
  return content ? { role: "user", content } : undefined;
}

export async function buildPostCompactRestorePayload(
  context: TuiContext,
): Promise<CompactRestorePayload> {
  const files = await readRestoreFiles(context);
  return {
    files,
    plan: formatActivePlan(context),
    runtimeStatus: collectRuntimeStatus(context),
    userConstraints: collectUserConstraints(context),
  };
}

export function formatPostCompactRestorePayload(
  payload: CompactRestorePayload,
): string | undefined {
  const sections = [
    "Post-compact restored context",
    "role current working context restored after deep compact",
  ];

  if (payload.files.length > 0) {
    sections.push("restored files");
    for (const file of payload.files) {
      sections.push(
        `file ${file.path}${file.truncated ? " (truncated)" : ""}\n\`\`\`\n${file.content}\n\`\`\``,
      );
    }
  }

  if (payload.plan) {
    sections.push(`active plan\n${payload.plan}`);
  }

  if (payload.runtimeStatus.length > 0) {
    sections.push(`active agents/workflows\n${payload.runtimeStatus.join("\n")}`);
  }

  if (payload.userConstraints.length > 0) {
    sections.push(`user constraints\n${payload.userConstraints.join("\n")}`);
  }

  if (sections.length === 2) return undefined;
  sections.push(
    "priority boundary: This restore context is a snapshot after compact. Later transcript messages and the latest user request still win.",
  );
  return truncateDisplay(sections.join("\n"), RESTORE_TOTAL_MAX_CHARS);
}

async function readRestoreFiles(context: TuiContext): Promise<CompactRestoreFile[]> {
  const candidates = uniqueFiles([
    ...context.recentlyMentionedFiles,
    ...context.tools.changedFiles,
    ...(context.cache.deepCompact?.preservedFiles ?? []),
  ]).slice(0, RESTORE_FILE_LIMIT);
  const files: CompactRestoreFile[] = [];
  let remaining = RESTORE_TOTAL_MAX_CHARS;

  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const resolved = resolveWorkspaceFile(context.projectPath, candidate);
    if (!resolved) continue;
    const raw = await readFile(resolved.absolutePath, "utf8").catch(() => undefined);
    if (!raw) continue;
    const maxChars = Math.min(RESTORE_FILE_MAX_CHARS, remaining);
    const sanitized = sanitizeRestoreText(context, raw, maxChars);
    if (!sanitized) continue;
    files.push({
      path: resolved.relativePath,
      content: sanitized,
      truncated: raw.length > maxChars || sanitized.length >= maxChars,
    });
    remaining -= sanitized.length;
  }
  return files;
}

function resolveWorkspaceFile(
  projectPath: string,
  candidate: string,
): { absolutePath: string; relativePath: string } | undefined {
  if (!candidate || candidate.includes("\0")) return undefined;
  const absolutePath = resolve(projectPath, candidate);
  const relativePath = relative(projectPath, absolutePath).replace(/\\/g, "/");
  if (relativePath.startsWith("../") || relativePath === ".." || relativePath.startsWith("/")) {
    return undefined;
  }
  return { absolutePath, relativePath };
}

function uniqueFiles(files: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const normalized = file.trim().replace(/\\/g, "/");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatActivePlan(context: TuiContext): string | undefined {
  const plan = context.activePlan;
  if (!plan) return undefined;
  const lines = [`PlanProposal ${plan.id}: ${plan.title}`];
  for (const option of plan.options.slice(0, 3)) {
    lines.push(`option ${option.id}: ${option.title}`);
    lines.push(...option.steps.slice(0, 8).map((step, index) => `${index + 1}. ${step}`));
    lines.push(...option.risks.slice(0, 4).map((risk) => `risk: ${risk}`));
  }
  return sanitizeRestoreText(context, lines.join("\n"), RESTORE_PLAN_MAX_CHARS);
}

function collectRuntimeStatus(context: TuiContext): string[] {
  const agents = context.agents
    .filter((agent) => ["running", "idle", "blocked", "stale"].includes(agent.status))
    .slice(0, 6)
    .map((agent) => {
      const name = agent.addressableName || agent.displayName || agent.id;
      return `agent ${name}: ${agent.status}; task ${agent.task}; activity ${agent.activitySummary || agent.activityStatus || "unknown"}`;
    });

  const workflowRuns = [
    ...(context.workflows.activeRuns ?? []),
    ...(context.workflows.activeRun ? [context.workflows.activeRun] : []),
  ];
  const workflows = workflowRuns
    .filter((run) => ["running", "partial", "blocked", "stale"].includes(run.status))
    .slice(0, 4)
    .map((run) => `workflow ${run.id}: ${run.status}; goal ${run.goal}`);

  return [...agents, ...workflows]
    .map((line) => sanitizeRestoreText(context, line, 320))
    .filter(Boolean)
    .slice(0, 10);
}

function sanitizeRestoreText(
  context: Pick<TuiContext, "projectPath">,
  value: string,
  maxChars: number,
): string {
  const redacted = redactCommonSecrets(value);
  const sanitized = sanitizeDiagnosticText(sanitizeDisplayPaths(redacted, context.projectPath));
  return truncateDisplay(sanitized, Math.max(0, maxChars - 1)).trim();
}

function collectUserConstraints(context: TuiContext): string[] {
  const tombstoneIndex = context.memory.tombstones;
  const candidates = context.memory.accepted
    .filter((item) => {
      if (item.status !== "accepted") return false;
      if (item.scope !== "user" && item.taxonomy !== "user") return false;
      if (isMemoryTombstoned(tombstoneIndex, item)) return false;
      return true;
    })
    .slice(0, RESTORE_MEMORY_LIMIT)
    .map((item) => sanitizeRestoreText(context, item.summary, RESTORE_MEMORY_ITEM_MAX_CHARS))
    .filter(Boolean);
  return candidates;
}
