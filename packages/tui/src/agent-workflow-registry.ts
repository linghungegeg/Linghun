import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { type ToolName, builtInTools } from "@linghun/tools";
import type { AgentType, WorkflowTemplate } from "./tui-data-types.js";

export type RegistryAgentDefinition = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model?: string;
  allowedTools?: ToolName[];
  maxTurns?: number;
  path: string;
};

export type RegistryWorkflowStep = {
  id: string;
  action: "agent" | "verification" | "index" | "details" | "bash" | "write";
  role?: AgentType;
  task?: string;
  level?: "smoke" | "focused" | "typecheck" | "test" | "build" | "lint";
  command?: string;
};

export type RegistryWorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  steps: RegistryWorkflowStep[];
  inputs?: Record<string, unknown>;
  runInBackground?: boolean;
  path: string;
};

export type RegistryLoadResult<T> =
  | { ok: true; items: T[]; errors: string[] }
  | { ok: false; items: T[]; errors: string[] };

export async function loadAgentRegistry(
  projectPath: string,
): Promise<RegistryLoadResult<RegistryAgentDefinition>> {
  return loadRegistryDir(join(projectPath, ".linghun", "agents"), parseAgentDefinition);
}

export async function loadWorkflowRegistry(
  projectPath: string,
): Promise<RegistryLoadResult<RegistryWorkflowDefinition>> {
  return loadRegistryDir(join(projectPath, ".linghun", "workflows"), parseWorkflowDefinition);
}

export function registryAgentToWorkflowTemplate(agent: RegistryAgentDefinition): WorkflowTemplate {
  return {
    id: `agent:${agent.id}`,
    purpose: agent.description,
    risk: "medium",
    writesFiles: (agent.allowedTools ?? []).some((tool) =>
      ["Write", "Edit", "MultiEdit", "Bash"].includes(tool),
    ),
    recommendedValidation: [],
    steps: [`agent ${agent.id}: ${agent.prompt}`],
  };
}

export function registryWorkflowToTemplate(workflow: RegistryWorkflowDefinition): WorkflowTemplate {
  return {
    id: workflow.id,
    purpose: workflow.description,
    risk: workflow.steps.some((step) => step.action === "bash" || step.action === "write")
      ? "high"
      : "medium",
    writesFiles: workflow.steps.some((step) => step.action === "write"),
    recommendedValidation: workflow.steps
      .filter((step) => step.action === "verification" && step.level)
      .map((step) => step.level as string),
    steps: workflow.steps.map((step) => `${step.action}:${step.id}`),
  };
}

async function loadRegistryDir<T>(
  dir: string,
  parse: (content: string, path: string) => T,
): Promise<RegistryLoadResult<T>> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { ok: true, items: [], errors: [] };
  }

  const items: T[] = [];
  const errors: string[] = [];
  for (const name of entries.filter((entry) => [".json", ".md"].includes(extname(entry))).sort()) {
    const path = join(dir, name);
    try {
      items.push(parse(await readFile(path, "utf8"), path));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: ${message}`);
    }
  }
  return { ok: errors.length === 0, items, errors };
}

function parseAgentDefinition(content: string, path: string): RegistryAgentDefinition {
  const value = parseRegistryContent(content, path);
  const obj = asRecord(value, "agent definition");
  const id = readRequiredString(obj, "id");
  const name = readRequiredString(obj, "name");
  const description = readRequiredString(obj, "description");
  const prompt = readRequiredString(obj, "prompt");
  const allowedTools = Array.isArray(obj.allowedTools)
    ? obj.allowedTools.map((item) => readAgentToolName(item, "allowedTools"))
    : undefined;
  return {
    id: assertSafeId(id, "id"),
    name,
    description,
    prompt,
    ...(typeof obj.model === "string" && obj.model.trim() ? { model: obj.model.trim() } : {}),
    ...(allowedTools ? { allowedTools } : {}),
    ...(typeof obj.maxTurns === "number" && Number.isInteger(obj.maxTurns) && obj.maxTurns > 0
      ? { maxTurns: obj.maxTurns }
      : {}),
    path,
  };
}

function parseWorkflowDefinition(content: string, path: string): RegistryWorkflowDefinition {
  const value = parseRegistryContent(content, path);
  const obj = asRecord(value, "workflow definition");
  const id = assertSafeId(readRequiredString(obj, "id"), "id");
  const name = readRequiredString(obj, "name");
  const description = readRequiredString(obj, "description");
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new Error("steps must be a non-empty array");
  }
  return {
    id,
    name,
    description,
    steps: obj.steps.map((step, index) => parseWorkflowStep(step, index)),
    ...(asOptionalRecord(obj.inputs) ? { inputs: obj.inputs as Record<string, unknown> } : {}),
    ...(typeof obj.runInBackground === "boolean" ? { runInBackground: obj.runInBackground } : {}),
    path,
  };
}

function parseWorkflowStep(value: unknown, index: number): RegistryWorkflowStep {
  const obj = asRecord(value, `steps[${index}]`);
  const action = obj.action;
  if (
    action !== "agent" &&
    action !== "verification" &&
    action !== "index" &&
    action !== "details" &&
    action !== "bash" &&
    action !== "write"
  ) {
    throw new Error(`steps[${index}].action is invalid`);
  }
  const step: RegistryWorkflowStep = {
    id: assertSafeId(
      typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `step-${index + 1}`,
      `steps[${index}].id`,
    ),
    action,
  };
  if (typeof obj.role === "string") {
    if (!isAgentTypeValue(obj.role)) throw new Error(`steps[${index}].role is invalid`);
    step.role = obj.role;
  }
  if (typeof obj.task === "string") step.task = obj.task.trim();
  if (typeof obj.level === "string") {
    if (!["smoke", "focused", "typecheck", "test", "build", "lint"].includes(obj.level)) {
      throw new Error(`steps[${index}].level is invalid`);
    }
    step.level = obj.level as RegistryWorkflowStep["level"];
  }
  if (typeof obj.command === "string") step.command = obj.command.trim();
  return step;
}

function parseRegistryContent(content: string, path: string): unknown {
  if (extname(path) === ".json") return JSON.parse(content);
  const match = /^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---/.exec(content);
  if (!match?.groups?.frontmatter) {
    throw new Error("markdown registry files require JSON frontmatter between --- markers");
  }
  return JSON.parse(match.groups.frontmatter);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRequiredString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function readArrayString(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} entries must be non-empty strings`);
  }
  return value.trim();
}

function readAgentToolName(value: unknown, key: string): ToolName {
  const name = readArrayString(value, key);
  if (!Object.prototype.hasOwnProperty.call(builtInTools, name)) {
    throw new Error(`${key} contains invalid tool: ${name}`);
  }
  return name as ToolName;
}

function assertSafeId(value: string, key: string): string {
  if (!/^[a-zA-Z0-9._-]{1,80}$/u.test(value)) {
    throw new Error(`${key} must contain only letters, digits, dot, underscore, or dash`);
  }
  return value;
}

function isAgentTypeValue(value: string): value is AgentType {
  return value === "explorer" || value === "planner" || value === "worker" || value === "verifier";
}
