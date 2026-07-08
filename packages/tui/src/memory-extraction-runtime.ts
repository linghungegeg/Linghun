import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { truncateDisplay } from "./startup-runtime.js";
import type { MemoryCandidate, MemoryScope, MemoryTaxonomy } from "./tui-data-types.js";

export const MEMORY_MANIFEST_FILE = "MEMORY.md";
const MEMORY_TOPICS_DIR = "topics";
const MEMORY_SUMMARY_WIDTH = 240;
const TOPIC_BODY_WIDTH = 800;

export const MEMORY_TAXONOMY: readonly MemoryTaxonomy[] = [
  "user",
  "feedback",
  "project",
  "reference",
];

const UNSAVEABLE_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "code_structure",
    pattern: /\b(?:src|packages|apps|docs)[\\/][\w./-]+|(?:function|class|interface|type)\s+\w+/iu,
  },
  {
    id: "git_history",
    pattern: /\b(?:git log|commit|branch|rebase|merge|stash|HEAD|SHA)\b|[a-f0-9]{7,40}/iu,
  },
  {
    id: "temporary_task",
    pattern: /(?:本轮|当前阶段|临时|todo|next step|handoff|pre-smoke\s+\d|阶段进度|交付文档)/iu,
  },
  {
    id: "debug_recipe",
    pattern: /(?:复现步骤|debug|stack trace|完整日志|error log|traceback|报错全文|stdout|stderr)/iu,
  },
  {
    id: "existing_rule",
    pattern: /(?:AGENTS\.md|LINGHUN\.md|已有规则|全局工作规则|project-doc)/iu,
  },
  {
    id: "secret",
    pattern:
      /(?:api[_-]?key|token|secret|password|credential|authorization|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----)/iu,
  },
  {
    id: "full_dump",
    pattern:
      /(?:完整 transcript|完整索引|完整日志|raw tool_result|raw evidence|full transcript|full index)/iu,
  },
];

type MemoryManifestEntry = {
  id: string;
  taxonomy: MemoryTaxonomy;
  topic: string;
  scope: Exclude<MemoryScope, "session">;
  summary: string;
  status: "accepted" | "disabled";
  updatedAt: string;
};

export type MemoryExtractionDecision =
  | { action: "no-op"; reason: string; blockedBy?: string }
  | {
      action: "create" | "update" | "delete";
      id: string;
      taxonomy: MemoryTaxonomy;
      topic: string;
      scope: Exclude<MemoryScope, "session">;
      summary: string;
      source: string;
      sourceRefs: string[];
      matchedExistingId?: string;
    };

export type MemoryExtractionInput = {
  recentMessages: string[];
  accepted: MemoryCandidate[];
  disabled: MemoryCandidate[];
  candidates?: MemoryCandidate[];
  now?: Date;
};

export type MemoryExtractionApplyResult = {
  decision: MemoryExtractionDecision;
  memory?: MemoryCandidate;
};

export function decideMemoryExtraction(input: MemoryExtractionInput): MemoryExtractionDecision {
  const text = input.recentMessages
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
  if (text.length < 8) return { action: "no-op", reason: "empty_or_too_short" };
  if (text.length > 2400) return { action: "no-op", reason: "too_long_for_safe_extraction" };

  const blocked = findUnsavableReason(text);
  if (blocked) return { action: "no-op", reason: "unsaveable_content", blockedBy: blocked };
  if (isMemoryLookupQuestion(text)) {
    return { action: "no-op", reason: "memory_lookup_question" };
  }

  const taxonomy = classifyTaxonomy(text);
  if (!taxonomy) return { action: "no-op", reason: "no_long_lived_fact" };

  if (isMemoryForgetRequest(text)) {
    const existing = findRelatedMemoryForIntent(input.accepted, taxonomy, text);
    if (!existing) return { action: "no-op", reason: "memory_forget_target_not_found" };
    return {
      action: "delete",
      id: existing.id,
      taxonomy: existing.taxonomy ?? taxonomy,
      topic: existing.topic ?? topicForSummary(existing.summary, existing.taxonomy ?? taxonomy),
      scope: existing.scope === "session" ? "project" : existing.scope,
      summary: existing.summary,
      source: "memory-extraction:turn",
      sourceRefs: ["turn:recent"],
      matchedExistingId: existing.id,
    };
  }

  const summary = summarizeLongLivedFact(text, taxonomy);
  if (!summary) return { action: "no-op", reason: "insufficient_specificity" };
  const summaryBlocked = findUnsavableReason(summary);
  if (summaryBlocked) {
    return { action: "no-op", reason: "unsaveable_summary", blockedBy: summaryBlocked };
  }

  const topic = topicForSummary(summary, taxonomy);
  const disabled = findRelatedMemory(input.disabled, taxonomy, topic, summary);
  if (disabled) {
    return { action: "no-op", reason: "disabled_existing_memory" };
  }

  const updateRequest = isMemoryUpdateRequest(text);
  const existing = updateRequest
    ? findRelatedMemoryForIntent(input.accepted, taxonomy, text, summary)
    : findRelatedMemory(input.accepted, taxonomy, topic, summary);
  if (updateRequest && !existing) {
    return { action: "no-op", reason: "memory_update_target_not_found" };
  }
  const duplicate = findRelatedMemory(
    [...input.accepted, ...input.disabled, ...(input.candidates ?? [])],
    taxonomy,
    topic,
    summary,
  );
  if (duplicate && normalizeText(duplicate.summary) === normalizeText(summary)) {
    return { action: "no-op", reason: "duplicate_existing_memory" };
  }

  return {
    action: existing ? "update" : "create",
    id: existing?.id ?? randomUUID(),
    taxonomy,
    topic,
    scope: taxonomy === "user" || taxonomy === "feedback" ? "user" : "project",
    summary,
    source: "memory-extraction:turn",
    sourceRefs: ["turn:recent"],
    ...(existing ? { matchedExistingId: existing.id } : {}),
  };
}

export async function applyMemoryExtractionDecision(input: {
  decision: MemoryExtractionDecision;
  memoryDir: string;
  existing?: MemoryCandidate;
  now?: Date;
}): Promise<MemoryExtractionApplyResult> {
  if (input.decision.action === "no-op") {
    return { decision: input.decision };
  }
  if (input.decision.action === "delete") {
    return { decision: input.decision };
  }
  const now = (input.now ?? new Date()).toISOString();
  const memory: MemoryCandidate = {
    ...(input.existing ?? {}),
    id: input.decision.id,
    scope: input.decision.scope,
    status: "accepted",
    taxonomy: input.decision.taxonomy,
    topic: input.decision.topic,
    summary: input.decision.summary,
    source: input.decision.source,
    sourceRefs: input.decision.sourceRefs,
    risk: "low",
    inferred: true,
    createdAt: input.existing?.createdAt ?? now,
  };
  await writeAutoMemoryFiles(input.memoryDir, memory, now);
  return { decision: input.decision, memory };
}

export async function writeAutoMemoryFiles(
  memoryDir: string,
  memory: MemoryCandidate,
  updatedAt = new Date().toISOString(),
): Promise<void> {
  const topic = memory.topic ?? topicForSummary(memory.summary, memory.taxonomy ?? "project");
  await mkdir(join(memoryDir, MEMORY_TOPICS_DIR), { recursive: true });
  await writeFile(
    join(memoryDir, MEMORY_TOPICS_DIR, `${topic}.md`),
    formatTopicMarkdown(memory, updatedAt),
    "utf8",
  );
  const manifest = await readManifest(memoryDir);
  const previous = manifest.find((entry) => entry.id === memory.id);
  if (previous && previous.topic !== topic) {
    await rm(join(memoryDir, MEMORY_TOPICS_DIR, `${previous.topic}.md`), { force: true });
  }
  const next = upsertManifestEntry(manifest, {
    id: memory.id,
    taxonomy: memory.taxonomy ?? "project",
    topic,
    scope: memory.scope === "session" ? "project" : memory.scope,
    summary: memory.summary,
    status: memory.status === "disabled" ? "disabled" : "accepted",
    updatedAt,
  });
  await writeManifest(memoryDir, next);
}

export async function refreshAutoMemoryFiles(
  memoryDir: string,
  accepted: MemoryCandidate[],
  disabled: MemoryCandidate[],
): Promise<void> {
  await mkdir(join(memoryDir, MEMORY_TOPICS_DIR), { recursive: true });
  const activeIds = new Set([...accepted, ...disabled].map((item) => item.id));
  const entries = [...accepted, ...disabled]
    .filter((item) => item.taxonomy && item.topic)
    .map(
      (item): MemoryManifestEntry => ({
        id: item.id,
        taxonomy: item.taxonomy ?? "project",
        topic: item.topic ?? topicForSummary(item.summary, item.taxonomy ?? "project"),
        scope: item.scope === "session" ? "project" : item.scope,
        summary: item.summary,
        status: item.status === "disabled" ? "disabled" : "accepted",
        updatedAt: item.createdAt,
      }),
    );
  for (const item of [...accepted, ...disabled].filter((entry) => entry.taxonomy && entry.topic)) {
    await writeFile(
      join(memoryDir, MEMORY_TOPICS_DIR, `${item.topic}.md`),
      formatTopicMarkdown(item, item.createdAt),
      "utf8",
    );
  }
  const previous = await readManifest(memoryDir);
  for (const entry of previous) {
    if (!activeIds.has(entry.id)) {
      await rm(join(memoryDir, MEMORY_TOPICS_DIR, `${entry.topic}.md`), { force: true });
    }
  }
  await writeManifest(memoryDir, entries);
}

export function findUnsavableReason(text: string): string | undefined {
  return UNSAVEABLE_PATTERNS.find((item) => item.pattern.test(text))?.id;
}

function isMemoryLookupQuestion(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /(?:我(?:的|有没有|是否|之前|刚才)?.{0,30}(?:偏好|习惯|喜欢|希望|记住|记忆).{0,40}(?:什么|吗|？|\?))/iu.test(
      normalized,
    ) ||
    /(?:what(?:'s| is).{0,40}(?:my|user).{0,30}(?:preference|default|memory)|did you remember.{0,60}(?:my|that))/iu.test(
      normalized,
    )
  );
}

function isMemoryForgetRequest(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /(?:忘记|删除|清除|移除).{0,80}(?:偏好|习惯|喜欢|希望|记忆|memory)/iu.test(normalized) ||
    /(?:不要|别|不再).{0,12}(?:记住|保存).{0,80}(?:偏好|习惯|喜欢|希望|记忆)/iu.test(
      normalized,
    ) ||
    /(?:我不再|不再).{0,12}(?:偏好|喜欢|希望)/iu.test(normalized) ||
    /(?:forget|delete|remove|clear).{0,80}(?:my|user)?.{0,30}(?:preference|memory|habit)/iu.test(
      normalized,
    )
  );
}

function isMemoryUpdateRequest(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /(?:更新为|改成|改为|换成)/iu.test(normalized) ||
    /(?:update|change|switch).{0,80}\bto\b/iu.test(normalized)
  );
}

function classifyTaxonomy(text: string): MemoryTaxonomy | undefined {
  if (
    /(?:反馈|不喜欢|太啰嗦|太慢|少废话|别空泛|feedback|too verbose|too slow|no fluff)/iu.test(text)
  ) {
    return "feedback";
  }
  if (
    /(?:我(?:习惯|偏好|喜欢|希望)|我的|用户偏好|prefer|preference|my default|i like|i usually)/iu.test(
      text,
    )
  ) {
    return "user";
  }
  if (
    /(?:本项目|这个项目|仓库|workspace|project uses|project should|项目约定|验证命令|默认命令)/iu.test(
      text,
    )
  ) {
    return "project";
  }
  if (/(?:参考|reference|文档|manual|external docs|公开行为|成熟行为)/iu.test(text)) {
    return "reference";
  }
  return undefined;
}

function summarizeLongLivedFact(text: string, taxonomy: MemoryTaxonomy): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  const updateSummary = summarizeUpdateRequest(normalized, taxonomy);
  if (updateSummary) return updateSummary;
  const explicit =
    normalized.match(/(?:记住|remember|长期记忆|保存为记忆)[:：]?\s*(.{8,180})/iu)?.[1] ??
    normalized.match(
      /(?:我(?:习惯|偏好|喜欢|希望)|prefer|preference|my default|i like|i usually)[:：]?\s*(.{8,180})/iu,
    )?.[1] ??
    normalized.match(
      /(?:本项目|这个项目|项目约定|project uses|project should)[:：]?\s*(.{8,180})/iu,
    )?.[1] ??
    normalized.match(/(?:反馈|feedback)[:：]?\s*(.{8,180})/iu)?.[1];
  const candidate = (explicit ?? normalized).trim();
  if (candidate.length < 8) return undefined;
  const prefix =
    taxonomy === "feedback"
      ? "User feedback"
      : taxonomy === "user"
        ? "User preference"
        : taxonomy === "reference"
          ? "Reference note"
          : "Project memory";
  return truncateDisplay(`${prefix}: ${candidate}`, MEMORY_SUMMARY_WIDTH);
}

function summarizeUpdateRequest(text: string, taxonomy: MemoryTaxonomy): string | undefined {
  if (!isMemoryUpdateRequest(text)) return undefined;
  const match =
    text.match(/(?:请)?(?:把|将)?(.{2,80}?)(?:更新为|改成|改为|换成)\s*(.{2,120})/iu) ??
    text.match(/(?:update|change|switch)\s+(.{2,80}?)\s+to\s+(.{2,120})/iu);
  if (!match) return undefined;
  const subject = cleanUpdateSubject(match[1] ?? "");
  const value = cleanUpdateValue(match[2] ?? "");
  if (!subject || !value) return undefined;
  const prefix =
    taxonomy === "feedback"
      ? "User feedback"
      : taxonomy === "user"
        ? "User preference"
        : taxonomy === "reference"
          ? "Reference note"
          : "Project memory";
  return truncateDisplay(`${prefix}: ${subject}：${value}`, MEMORY_SUMMARY_WIDTH);
}

function cleanUpdateSubject(text: string): string {
  return text
    .replace(/^(?:请|please)\s*/iu, "")
    .replace(/^(?:把|将)\s*/u, "")
    .replace(/^(?:我(?:的|偏好的|偏好)?|my)\s*/iu, "")
    .replace(/^(?:用户)?(?:偏好|preference)\s*/iu, "")
    .replace(/[，,。.\s:：]+$/u, "")
    .trim();
}

function cleanUpdateValue(text: string): string {
  return text.replace(/[，,。.\s]+$/u, "").trim();
}

function findRelatedMemory(
  memories: MemoryCandidate[],
  taxonomy: MemoryTaxonomy,
  topic: string,
  summary: string,
): MemoryCandidate | undefined {
  return memories.find((item) => {
    if (item.taxonomy && item.taxonomy !== taxonomy) return false;
    if (item.topic && item.topic === topic) return true;
    if (hasMeaningfulOverlap(item.summary, summary)) return true;
    return normalizeText(item.summary) === normalizeText(summary);
  });
}

function findRelatedMemoryForIntent(
  memories: MemoryCandidate[],
  taxonomy: MemoryTaxonomy,
  text: string,
  summary?: string,
): MemoryCandidate | undefined {
  return memories.find((item) => {
    if (item.taxonomy && item.taxonomy !== taxonomy) return false;
    if (
      summary &&
      findRelatedMemory([item], taxonomy, topicForSummary(summary, taxonomy), summary)
    ) {
      return true;
    }
    return hasIntentOverlap(item.summary, text);
  });
}

function hasIntentOverlap(summary: string, text: string): boolean {
  const left = intentTokens(summary);
  const right = intentTokens(text);
  let wordOverlap = 0;
  for (const word of left.words) {
    if (right.words.has(word)) wordOverlap += 1;
  }
  let cjkOverlap = 0;
  for (const char of left.cjkChars) {
    if (right.cjkChars.has(char)) cjkOverlap += 1;
  }
  return wordOverlap >= 1 || cjkOverlap >= 4;
}

function intentTokens(text: string): { words: Set<string>; cjkChars: Set<string> } {
  const normalized = normalizeText(text)
    .replace(
      /(?:user|preference|feedback|project|memory|reference|用户|偏好|习惯|喜欢|希望|记忆|请|把|将|忘记|删除|清除|移除|不要|别|不再|记住|保存|更新为|改成|改为|换成|格式|为|用)/giu,
      " ",
    )
    .replace(/\s+/g, " ");
  return {
    words: new Set(
      normalized
        .split(/[^a-z0-9]+/iu)
        .filter((word) => word.length >= 3)
        .filter((word) => !["the", "and", "for", "with"].includes(word)),
    ),
    cjkChars: new Set(Array.from(normalized.replace(/[^\u4e00-\u9fa5]/gu, ""))),
  };
}

function hasMeaningfulOverlap(left: string, right: string): boolean {
  const leftWords = keywords(left);
  const rightWords = keywords(right);
  if (leftWords.size === 0 || rightWords.size === 0) return false;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  return overlap >= 2;
}

function keywords(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(/[^a-z0-9\u4e00-\u9fa5]+/iu)
      .filter((word) => word.length >= 2)
      .filter((word) => !["user", "preference", "project", "memory", "feedback"].includes(word)),
  );
}

function topicForSummary(summary: string, taxonomy: MemoryTaxonomy): string {
  const normalized = normalizeText(summary)
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${taxonomy}-${normalized || "memory"}`;
}

function normalizeText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

async function readManifest(memoryDir: string): Promise<MemoryManifestEntry[]> {
  try {
    return parseManifest(await readFile(join(memoryDir, MEMORY_MANIFEST_FILE), "utf8"));
  } catch {
    return [];
  }
}

function parseManifest(content: string): MemoryManifestEntry[] {
  const entries: MemoryManifestEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(
      /^- \[([^\]]+)\] \((accepted|disabled)\) ([^/]+)\/([^:]+): (.+?) \(updated (.+)\)$/u,
    );
    if (!match) continue;
    const taxonomy = MEMORY_TAXONOMY.includes(match[3] as MemoryTaxonomy)
      ? (match[3] as MemoryTaxonomy)
      : "project";
    entries.push({
      id: match[1],
      status: match[2] as "accepted" | "disabled",
      taxonomy,
      topic: match[4],
      scope: taxonomy === "user" || taxonomy === "feedback" ? "user" : "project",
      summary: match[5],
      updatedAt: match[6],
    });
  }
  return entries;
}

function upsertManifestEntry(
  entries: MemoryManifestEntry[],
  entry: MemoryManifestEntry,
): MemoryManifestEntry[] {
  return [entry, ...entries.filter((item) => item.id !== entry.id)].sort((a, b) =>
    a.topic.localeCompare(b.topic),
  );
}

async function writeManifest(memoryDir: string, entries: MemoryManifestEntry[]): Promise<void> {
  await mkdir(memoryDir, { recursive: true });
  await writeFile(
    join(memoryDir, MEMORY_MANIFEST_FILE),
    [
      "# Linghun Memory",
      "",
      "Long-lived auto memory index. LINGHUN.md remains project rules and is not rewritten here.",
      "",
      ...entries.map(
        (entry) =>
          `- [${entry.id}] (${entry.status}) ${entry.taxonomy}/${entry.topic}: ${truncateDisplay(entry.summary, MEMORY_SUMMARY_WIDTH)} (updated ${entry.updatedAt})`,
      ),
      "",
    ].join("\n"),
    "utf8",
  );
}

function formatTopicMarkdown(memory: MemoryCandidate, updatedAt: string): string {
  return [
    "---",
    `id: ${memory.id}`,
    `taxonomy: ${memory.taxonomy ?? "project"}`,
    `scope: ${memory.scope}`,
    `status: ${memory.status}`,
    `updatedAt: ${updatedAt}`,
    "---",
    "",
    `# ${memory.topic ?? "memory"}`,
    "",
    truncateDisplay(memory.summary.replace(/\s+/g, " "), TOPIC_BODY_WIDTH),
    "",
    `Source: ${memory.source}`,
    `Refs: ${memory.sourceRefs.slice(0, 6).join(", ") || "none"}`,
    "",
  ].join("\n");
}
