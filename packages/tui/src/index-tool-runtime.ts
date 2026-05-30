/**
 * index-tool-runtime.ts — D.14D-R P0-2 structured codebase-index capabilities
 * exposed to the model.
 *
 * 这些是 Linghun 自研的结构化索引工具（与 git-tool-runtime.ts 同款范式，不是
 * Anthropic defer_loading，也不是 codebase-memory deferred dispatch）：
 *   - IndexStatusInspect  （只读：刷新并返回当前索引状态，不重建）
 *   - IndexRefresh        （刷新/重建项目索引，走权限确认）
 *   - IndexRepair         （追加 ignore 条目后刷新索引，走权限确认）
 *
 * 设计原则：
 * - 工具进入模型 tool schema（与 built-in / Git 工具同级）。模型需要"看索引 / 更新
 *   索引"时必须调用结构化工具，而不是用文本冒充执行，也不是本地自然语言 regex 拦截。
 * - 本模块只做：schema 定义、input 解析、result → 人话摘要。真正的索引操作复用
 *   mcp-index-runtime 的 refreshIndexStatus / runIndexRepository / runIndexSafetyRepair；
 *   权限确认走 index.ts 既有 pendingLocalApproval / PermissionPanel 管道。
 * - 工具结果以结构化文本返回，进入 transcript/evidence；final answer 只能基于工具
 *   结果声明"已刷新 / 仅检查 / 未执行"，不能空口说"索引已更新"。
 */

import type { ModelToolDefinition } from "@linghun/providers";
import type { Language } from "@linghun/shared";

export const INDEX_STATUS_INSPECT = "IndexStatusInspect" as const;
export const INDEX_REFRESH = "IndexRefresh" as const;
export const INDEX_REPAIR = "IndexRepair" as const;

export const INDEX_TOOL_NAMES: readonly string[] = [
  INDEX_STATUS_INSPECT,
  INDEX_REFRESH,
  INDEX_REPAIR,
];

export function isIndexToolName(name: string): boolean {
  return INDEX_TOOL_NAMES.includes(name);
}

export type IndexToolName = typeof INDEX_STATUS_INSPECT | typeof INDEX_REFRESH | typeof INDEX_REPAIR;

/** 仅 IndexRefresh / IndexRepair 是 mutating（需要权限确认）；Inspect 只读。 */
export function isMutatingIndexTool(name: string): name is typeof INDEX_REFRESH | typeof INDEX_REPAIR {
  return name === INDEX_REFRESH || name === INDEX_REPAIR;
}

// ---------------------------------------------------------------------------
// Model tool schema
// ---------------------------------------------------------------------------

export function createIndexToolDefinitions(): ModelToolDefinition[] {
  return [
    {
      name: INDEX_STATUS_INSPECT,
      description:
        "Inspect the current codebase-memory index status for this project (refreshes the status read, but does NOT rebuild the index). Read-only and safe to call without confirmation. Returns enabled/status/projectName/nodes/edges. Use this when the user asks whether the index is ready or what its current state is. Do NOT claim the index was refreshed — this only reads status.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          reason: { type: "string" },
        },
      },
    },
    {
      name: INDEX_REFRESH,
      description:
        "Refresh (rebuild) the codebase-memory index for this project, reusing the controlled /index refresh path. This is a mutating action: it writes the index artifact and runs the external index runtime, so it requires user permission confirmation in default/auto-review modes. Call this tool to actually refresh the index when the user asks to update/refresh/rebuild the index. Do NOT claim the index was refreshed unless this tool returns success.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          force: { type: "boolean" },
          reason: { type: "string" },
        },
      },
    },
    {
      name: INDEX_REPAIR,
      description:
        "Repair the index when large/risky files block a refresh: append the missing ignore entries (.linghunignore/.cbmignore) and then refresh, reusing the controlled /index repair path. Mutating action requiring user permission confirmation. Only meaningful when an index safety blocker is active. Call this tool to actually repair-and-refresh; do NOT claim it succeeded without a success result.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          reason: { type: "string" },
        },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export type IndexRefreshToolInput = { force?: boolean; reason?: string };

export function parseIndexRefreshInput(input: unknown): IndexRefreshToolInput {
  const obj = asRecord(input);
  return {
    force: typeof obj.force === "boolean" ? obj.force : undefined,
    reason: typeof obj.reason === "string" ? obj.reason : undefined,
  };
}

// ---------------------------------------------------------------------------
// Result shaping — index 状态 → 人话主屏文案
// ---------------------------------------------------------------------------

/**
 * IndexStatusInspect 结果摘要。明确标注"仅检查，未刷新"，避免模型据此声称已刷新。
 */
export function summarizeIndexStatusInspect(
  status: string,
  projectName: string | undefined,
  nodes: number | undefined,
  edges: number | undefined,
  language: Language,
): string {
  const isEn = language === "en-US";
  const project = projectName ?? (isEn ? "(not selected)" : "（未选中）");
  const counts = nodes !== undefined || edges !== undefined ? ` nodes=${nodes ?? "-"} edges=${edges ?? "-"}` : "";
  return isEn
    ? `Index status inspected (NOT refreshed): status=${status}; project=${project};${counts}`
    : `已检查索引状态（未刷新）：状态=${status}；项目=${project};${counts}`;
}

/**
 * IndexRefresh / IndexRepair 成功后的结果摘要。明确标注已刷新与最终状态。
 */
export function summarizeIndexRefreshOutcome(
  action: "refresh" | "repair",
  status: string,
  language: Language,
): string {
  const isEn = language === "en-US";
  const label = action === "repair" ? (isEn ? "repaired and refreshed" : "已修复并刷新") : isEn ? "refreshed" : "已刷新";
  return isEn
    ? `Index ${label}: status=${status}.`
    : `索引${label}：状态=${status}。`;
}
