import type { OrchestrationStep } from "./meta-scheduler-runtime.js";
import { appendSystemEvent } from "./evidence-runtime.js";
import { truncateDisplay } from "./startup-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";

export type MetaOrchestrationStepId = OrchestrationStep["id"];
export type MetaOrchestrationExecutor = OrchestrationStep["executor"];
export type MetaOrchestrationMode = OrchestrationStep["mode"];
export type MetaOrchestrationAction = {
  stepId: MetaOrchestrationStepId;
  mode: MetaOrchestrationMode;
  executor: MetaOrchestrationExecutor;
  reason: string;
  shouldRun: boolean;
  shouldAsk: boolean;
  shouldDegrade: boolean;
  shouldStop: boolean;
};
export type MetaOrchestrationStatus =
  | "planned"
  | "consumed"
  | "completed"
  | "degraded"
  | "blocked"
  | "failed";

export type MetaOrchestrationRuntimeEvent = {
  stepId: MetaOrchestrationStepId;
  executor: MetaOrchestrationExecutor;
  mode: MetaOrchestrationMode;
  status: MetaOrchestrationStatus;
  summary: string;
  createdAt: string;
};

const MAX_META_ORCHESTRATION_EVENTS = 80;

export function getMetaOrchestrationStep(
  context: Pick<TuiContext, "lastMetaSchedulerDecision">,
  stepId: MetaOrchestrationStepId,
): OrchestrationStep | undefined {
  return context.lastMetaSchedulerDecision?.orchestrationPlan.steps.find(
    (step) => step.id === stepId,
  );
}

export function getMetaOrchestrationMode(
  context: Pick<TuiContext, "lastMetaSchedulerDecision">,
  stepId: MetaOrchestrationStepId,
): MetaOrchestrationMode | undefined {
  return getMetaOrchestrationStep(context, stepId)?.mode;
}

export function shouldStopForMetaOrchestration(
  context: Pick<TuiContext, "lastMetaSchedulerDecision">,
  stepId: MetaOrchestrationStepId,
): boolean {
  return getMetaOrchestrationMode(context, stepId) === "stop";
}

export function resolveMetaOrchestrationAction(
  context: Pick<TuiContext, "lastMetaSchedulerDecision">,
  stepId: MetaOrchestrationStepId,
): MetaOrchestrationAction {
  const step = getMetaOrchestrationStep(context, stepId);
  const mode = step?.mode ?? "run";
  return {
    stepId,
    mode,
    executor: step?.executor ?? "meta-scheduler",
    reason: step?.reason ?? "No explicit meta-scheduler step was planned; continue with default runtime behavior.",
    shouldRun: mode === "run",
    shouldAsk: mode === "ask",
    shouldDegrade: mode === "degrade",
    shouldStop: mode === "stop",
  };
}

export async function recordMetaOrchestrationRuntimeEvent(
  context: TuiContext,
  sessionId: string | undefined,
  input: {
    stepId: MetaOrchestrationStepId;
    executor?: MetaOrchestrationExecutor;
    mode?: MetaOrchestrationMode;
    status: MetaOrchestrationStatus;
    summary: string;
    level?: "info" | "warning";
  },
): Promise<void> {
  const planned = getMetaOrchestrationStep(context, input.stepId);
  const event: MetaOrchestrationRuntimeEvent = {
    stepId: input.stepId,
    executor: input.executor ?? planned?.executor ?? "meta-scheduler",
    mode: input.mode ?? planned?.mode ?? "run",
    status: input.status,
    summary: truncateDisplay(input.summary.replace(/\s+/g, " ").trim(), 220),
    createdAt: new Date().toISOString(),
  };
  const state = context.metaOrchestration ?? { events: [] };
  state.events.push(event);
  if (state.events.length > MAX_META_ORCHESTRATION_EVENTS) {
    state.events.splice(0, state.events.length - MAX_META_ORCHESTRATION_EVENTS);
  }
  context.metaOrchestration = state;
  if (!sessionId) return;
  await appendSystemEvent(
    context,
    sessionId,
    `meta_orchestration:${event.stepId}; executor=${event.executor}; mode=${event.mode}; status=${event.status}; summary=${event.summary}`,
    input.level ?? (event.status === "failed" || event.status === "blocked" ? "warning" : "info"),
  );
}

export function summarizeMetaOrchestrationState(context: TuiContext): string | undefined {
  const events = context.metaOrchestration?.events ?? [];
  if (events.length === 0) return undefined;
  return events
    .slice(-8)
    .map((event) => `${event.stepId}:${event.status}`)
    .join(",");
}
