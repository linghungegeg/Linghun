import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type KeybindingContext = "global" | "chat" | "autocomplete";
export type KeybindingAction =
  | "toggle-details"
  | "cycle-permission-mode"
  | "interrupt"
  | "submit"
  | "clear-line"
  | "delete-word-left";

export type Keybinding = {
  context: KeybindingContext;
  keys: string[];
  action: KeybindingAction;
};

export type KeyEventLike = {
  input: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  tab?: boolean;
  escape?: boolean;
  return?: boolean;
  name?: string;
};

export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  { context: "global", keys: ["ctrl+o"], action: "toggle-details" },
  { context: "global", keys: ["shift+tab"], action: "cycle-permission-mode" },
  { context: "chat", keys: ["ctrl+c"], action: "interrupt" },
  { context: "chat", keys: ["enter"], action: "submit" },
  { context: "chat", keys: ["ctrl+u"], action: "clear-line" },
  { context: "chat", keys: ["ctrl+w"], action: "delete-word-left" },
];

export function resolveKeybinding(
  bindings: Keybinding[],
  context: KeybindingContext,
  event: KeyEventLike,
  chordBuffer: string[] = [],
): { action?: KeybindingAction; chordBuffer: string[]; pending: boolean } {
  const key = normalizeKeyEvent(event);
  const nextChord = [...chordBuffer, key].filter(Boolean);
  const candidates = bindings.filter(
    (binding) => binding.context === context || binding.context === "global",
  );
  const exact = candidates.find((binding) => sameKeys(binding.keys, nextChord));
  if (exact) return { action: exact.action, chordBuffer: [], pending: false };
  const pending = candidates.some((binding) => isPrefix(nextChord, binding.keys));
  return { chordBuffer: pending ? nextChord : [], pending };
}

export async function loadProjectKeybindings(projectPath: string): Promise<Keybinding[]> {
  const path = join(projectPath, ".linghun", "keybindings.json");
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw) return DEFAULT_KEYBINDINGS;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return DEFAULT_KEYBINDINGS;
  const custom = parsed.flatMap(parseKeybinding);
  return mergeKeybindings(DEFAULT_KEYBINDINGS, custom);
}

export function mergeKeybindings(defaults: Keybinding[], custom: Keybinding[]): Keybinding[] {
  const next = [...defaults];
  for (const binding of custom) {
    const index = next.findIndex(
      (item) => item.context === binding.context && sameKeys(item.keys, binding.keys),
    );
    if (index >= 0) next[index] = binding;
    else next.push(binding);
  }
  return next;
}

export function normalizeKeyEvent(event: KeyEventLike): string {
  if (event.tab && event.shift) return "shift+tab";
  if (event.tab) return "tab";
  if (event.return || event.name === "return") return "enter";
  if (event.escape || event.name === "escape") return "escape";
  const parts: string[] = [];
  if (event.ctrl) parts.push("ctrl");
  if (event.meta) parts.push("meta");
  if (event.shift) parts.push("shift");
  const base = event.name ?? event.input;
  if (base) parts.push(base.toLowerCase());
  return parts.join("+");
}

function parseKeybinding(value: unknown): Keybinding[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (
    record.context !== "global" &&
    record.context !== "chat" &&
    record.context !== "autocomplete"
  ) {
    return [];
  }
  if (!Array.isArray(record.keys) || !record.keys.every((item) => typeof item === "string")) {
    return [];
  }
  if (
    record.action !== "toggle-details" &&
    record.action !== "cycle-permission-mode" &&
    record.action !== "interrupt" &&
    record.action !== "submit" &&
    record.action !== "clear-line" &&
    record.action !== "delete-word-left"
  ) {
    return [];
  }
  return [
    {
      context: record.context,
      keys: record.keys.map((item) => item.toLowerCase()),
      action: record.action,
    },
  ];
}

function sameKeys(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isPrefix(prefix: string[], target: string[]): boolean {
  return prefix.length < target.length && prefix.every((item, index) => item === target[index]);
}
