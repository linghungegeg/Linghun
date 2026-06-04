// Module 5: tui-details-runtime
// Pure /details command helpers extracted from packages/tui/src/index.ts as
// part of the D.13 mechanical split. Behavior is unchanged. The
// handleDetailsCommand / runDetailsCommandBody coordinators stay in index.ts
// because they depend on writeLine, formatError, MAX_AGENTS, MAX_CHECKPOINTS
// and other index-side helpers that would create cross-module cycles
// (Path A safety valve #2).
//
// What moved here:
//   - findEvidence (pure)
//   - formatEvidenceDetails (pure)
//   - parseLogArtifactRequest (pure)
//   - readPositiveIntegerArg (pure)
//   - createLogArtifactRegistry (type-only TuiContext)
//   - formatAgentDetails (type-only TuiContext)
//
// All consumers continue to import via "../index.js"; index.ts re-exports
// the symbols below and imports them value-side for internal callers.

import { join } from "node:path";
import type { TuiContext } from "./index.js";
import { deriveAgentDisplayName } from "./job-runtime.js";
import type { LogArtifactRequest } from "./log-artifact.js";
import { formatDisplayPath, sanitizeDisplayPaths, truncateDisplay } from "./startup-runtime.js";
import type { AgentRun, EvidenceRecord } from "./tui-data-types.js";

export function findEvidence(
  context: TuiContext,
  id: string | undefined,
): EvidenceRecord | undefined {
  if (!id) {
    return context.evidence[0];
  }
  return context.evidence.find((evidence) => evidence.id === id || evidence.id.endsWith(id));
}

export function formatEvidenceDetails(evidence: EvidenceRecord, projectPath?: string): string {
  return [
    `Evidence ${evidence.id}`,
    `- kind: ${evidence.kind}`,
    `- source: ${sanitizeDisplayPaths(evidence.source, projectPath)}`,
    `- summary: ${sanitizeDisplayPaths(evidence.summary, projectPath)}`,
    `- supports claims: ${evidence.supportsClaims.join(", ") || "none"}`,
    `- created at: ${evidence.createdAt}`,
  ].join("\n");
}

export function parseLogArtifactRequest(args: string[]): LogArtifactRequest | undefined {
  const tailIndex = args.indexOf("--tail");
  if (tailIndex >= 0) {
    return {
      mode: "tail",
      lines: readPositiveIntegerArg(args[tailIndex + 1]),
    };
  }
  const grepIndex = args.indexOf("--grep");
  if (grepIndex >= 0) {
    const contextIndex = args.indexOf("--context");
    return {
      mode: "grep",
      pattern: args[grepIndex + 1],
      contextLines: contextIndex >= 0 ? readPositiveIntegerArg(args[contextIndex + 1]) : undefined,
    };
  }
  if (args.includes("--errors")) {
    return { mode: "errors" };
  }
  return undefined;
}

export function readPositiveIntegerArg(value: string | undefined): number | undefined {
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function createLogArtifactRegistry(context: TuiContext) {
  return {
    workspaceRoot: context.projectPath,
    logRoots: [join(context.projectPath, ".linghun", "logs")],
    backgrounds: context.backgroundTasks.map((task) => ({
      id: task.id,
      outputPath: task.outputPath,
      logPath: task.logPath,
    })),
    evidence: context.evidence.map((evidence) => ({
      id: evidence.id,
      source: evidence.source,
      fullOutputPath: evidence.fullOutputPath,
      outputPath: evidence.outputPath,
      logPath: evidence.logPath,
    })),
  };
}

export function formatAgentDetails(agent: AgentRun, context: TuiContext): string {
  const label = agent.displayName ?? deriveAgentDisplayName(agent.type, agent.task);
  const mailbox = agent.mailbox ?? [];
  const mailboxCounts = {
    pending: mailbox.filter((message) => (message.status ?? "pending") === "pending").length,
    consumed: mailbox.filter((message) => message.status === "consumed").length,
    failed: mailbox.filter((message) => message.status === "failed").length,
  };
  const mailboxTail = mailbox.slice(-5);
  const lines = [
    `Agent ${agent.id} (${label})`,
    `- display name: ${label}`,
    `- type: ${agent.type}`,
    `- name: ${agent.addressableName ?? "none"}`,
    `- team: ${agent.teamName ?? "none"}`,
    `- role: ${agent.role}`,
    `- model route: ${agent.provider} / ${agent.model}`,
    `- registry agent id: ${agent.registryAgentId ?? "none"}`,
    `- max turns: ${agent.maxTurns ?? "default"}`,
    `- allowed tools: ${agent.allowedTools?.join(",") ?? "default"}`,
    `- status: ${agent.status}`,
    `- activity: ${agent.activityStatus ?? "unknown"}${agent.activitySummary ? ` — ${sanitizeDisplayPaths(agent.activitySummary, context.projectPath)}` : ""}`,
    `- task: ${truncateDisplay(agent.task, 120)}`,
    `- parent session: ${agent.parentSessionId ?? "none"}`,
    `- transcript: ${formatDisplayPath(agent.transcriptPath, context.projectPath)}`,
    `- cwd: ${agent.cwd ? formatDisplayPath(agent.cwd, context.projectPath) : "."}`,
    `- mailbox: pending ${mailboxCounts.pending}, consumed ${mailboxCounts.consumed}, failed ${mailboxCounts.failed}`,
    `- permission mode: ${agent.permissionMode}`,
    `- cost: input ${agent.cost.inputTokens}, output ${agent.cost.outputTokens}, cache read ${agent.cost.cacheReadTokens}, cache write ${agent.cost.cacheWriteTokens}, estimated CNY ${agent.cost.estimatedCny}`,
    "- boundary: display name does not change type, role route, permission mode, resource guard, evidence, or lifecycle",
    `- context: ${sanitizeDisplayPaths(agent.contextSummary, context.projectPath)}`,
    `- summary: ${sanitizeDisplayPaths(agent.summary, context.projectPath)}`,
  ];
  if (agent.status === "running") {
    lines.push(
      context.language === "en-US"
        ? `- cancel: /agents cancel ${agent.id}`
        : `- 中断：/agents cancel ${agent.id}`,
    );
  }
  if (mailboxTail.length > 0) {
    lines.push("- mailbox tail:");
    for (const message of mailboxTail) {
      lines.push(
        `  - ${message.id} ${message.status ?? (message.consumedAt ? "consumed" : "pending")} from ${message.from} to ${message.to ?? agent.id}: ${sanitizeDisplayPaths(message.summary ?? truncateDisplay(message.text.replace(/\s+/g, " "), 120), context.projectPath)}`,
      );
    }
  }
  return lines.join("\n");
}
