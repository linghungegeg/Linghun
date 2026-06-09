import type { SemanticClass } from "./permission-policy-engine.js";

export type AgentHandoffRequest = {
  parentPermissionMode: string;
  childTools: string[];
  childScope: string;
  parentScope: string;
};

export type HandoffVerdict = {
  allowed: boolean;
  deniedTools: string[];
  reason?: string;
};

const MUTATING_SEMANTICS: ReadonlySet<SemanticClass> = new Set<SemanticClass>([
  "mutating",
  "destructive",
  "install",
  "outside_workspace",
]);

const KNOWN_MUTATING_TOOLS: Set<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "Bash",
  "PowerShell",
  "NotebookEdit",
]);

function isMutatingTool(tool: string): boolean {
  return KNOWN_MUTATING_TOOLS.has(tool);
}

function scopeExceedsParent(childScope: string, parentScope: string): boolean {
  if (!parentScope) return false;
  const normalizedChild = childScope.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedParent = parentScope.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalizedChild === normalizedParent) return false;
  return !normalizedChild.startsWith(normalizedParent + "/");
}

export function validateHandoff(request: AgentHandoffRequest): HandoffVerdict {
  const { parentPermissionMode, childTools, childScope, parentScope } = request;

  if (scopeExceedsParent(childScope, parentScope)) {
    return {
      allowed: false,
      deniedTools: childTools,
      reason: `Child scope "${childScope}" extends beyond parent scope "${parentScope}"`,
    };
  }

  if (parentPermissionMode === "plan") {
    const denied = childTools.filter(isMutatingTool);
    if (denied.length > 0) {
      return {
        allowed: false,
        deniedTools: denied,
        reason: "Parent is in plan mode; mutating tools are not permitted for child agents",
      };
    }
  }

  return { allowed: true, deniedTools: [] };
}
