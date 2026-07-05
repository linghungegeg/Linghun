import type { TuiContext } from "./index.js";
import type { AgentRun } from "./tui-data-types.js";
import type { ProductBlockViewModel } from "./shell/types.js";
import {
  transcriptSourceKindForBlock,
  transcriptSourceRawTextForBlock,
  upsertTranscriptSourceCell,
} from "./shell/models/transcript-source.js";

const AGENT_KEEP_RECENT = 5;
const AGENT_FULL_REPORT_MAX_CHARS = 400;
const BLOCK_KEEP_RECENT = 60;
const BLOCK_FULLTEXT_EVICT_CHARS = 200;
const TOOL_BUDGET_STATE_MAX_ENTRIES = 200;

export function evictCompletedAgents(context: TuiContext): void {
  const agents: AgentRun[] = context.agents;
  if (agents.length <= AGENT_KEEP_RECENT) return;

  const terminal = (a: AgentRun) =>
    a.status === "completed" || a.status === "failed" || a.status === "cancelled";

  let evictCount = 0;
  for (let i = agents.length - 1; i >= 0; i--) {
    const agent = agents[i];
    if (!agent || !terminal(agent)) continue;
    evictCount++;
    if (evictCount <= AGENT_KEEP_RECENT) continue;
    if (agent.lastResultFullReport && agent.lastResultFullReport.length > AGENT_FULL_REPORT_MAX_CHARS) {
      agent.lastResultFullReport = agent.lastResultFullReport.slice(0, AGENT_FULL_REPORT_MAX_CHARS) + "…[evicted]";
    }
    agent.mailbox = [];
    agent.contextSummary = "";
  }
}

export function evictCommittedBlocks(
  blocks: ProductBlockViewModel[],
  transcriptSource?: TuiContext["transcriptSource"],
): void {
  if (blocks.length <= BLOCK_KEEP_RECENT) return;
  const evictBefore = blocks.length - BLOCK_KEEP_RECENT;
  for (let i = 0; i < evictBefore; i++) {
    const block = blocks[i];
    if (!block) continue;
    if (block.fullText && block.fullText.length > BLOCK_FULLTEXT_EVICT_CHARS) {
      block.fullText = block.fullText.slice(0, BLOCK_FULLTEXT_EVICT_CHARS) + "…[evicted]";
      syncEvictedBlockToTranscriptSource(block, transcriptSource);
    }
  }
}

function syncEvictedBlockToTranscriptSource(
  block: ProductBlockViewModel,
  transcriptSource: TuiContext["transcriptSource"],
): void {
  if (!transcriptSource) return;
  const kind = transcriptSourceKindForBlock(block);
  if (!kind) return;
  upsertTranscriptSourceCell(transcriptSource, {
    id: block.id,
    kind,
    block,
    rawText: transcriptSourceRawTextForBlock(block),
  });
}

export function pruneToolResultBudgetState(context: TuiContext): void {
  const state = context.toolResultBudgetState;
  if (!state) return;
  if (state.seenIds.size <= TOOL_BUDGET_STATE_MAX_ENTRIES) return;
  const idsArray = Array.from(state.seenIds);
  const removeCount = idsArray.length - TOOL_BUDGET_STATE_MAX_ENTRIES;
  for (let i = 0; i < removeCount; i++) {
    const id = idsArray[i];
    if (id) {
      state.seenIds.delete(id);
      const replacement = state.replacements.get(id);
      state.replacements.delete(id);
      if (replacement) {
        state.contentReplacements?.delete(buildContentReplacementKey(replacement));
      }
    }
  }
}

function buildContentReplacementKey(replacement: {
  record: { artifact: { chars: number; bytes: number; sha256: string } };
  fingerprint: string;
}): string {
  const sessionId = replacement.fingerprint.split("\0")[0] ?? "";
  const artifact = replacement.record.artifact;
  return [sessionId, artifact.chars, artifact.bytes, artifact.sha256].join("\0");
}

export function runMemoryEviction(context: TuiContext, blocks: ProductBlockViewModel[]): void {
  evictCompletedAgents(context);
  evictCommittedBlocks(blocks, context.transcriptSource);
  pruneToolResultBudgetState(context);
}
