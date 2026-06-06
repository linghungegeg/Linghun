import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { truncateDisplay } from "./startup-runtime.js";

export const MAX_MEMORY_CHARACTER_COUNT = 40_000;
const MAX_INCLUDE_DEPTH = 5;

export type LoadedMemoryRules = {
  content: string;
  truncated: boolean;
  includedPaths: string[];
  warnings: string[];
};

export type MemoryRuleFrontmatter = {
  paths: string[];
  body: string;
};

export async function loadMemoryRulesFile(path: string): Promise<LoadedMemoryRules> {
  const root = resolve(path);
  const warnings: string[] = [];
  const includedPaths: string[] = [];
  const content = await loadMemoryFileRecursive(root, root, new Set(), 0, includedPaths, warnings);
  if (content.length <= MAX_MEMORY_CHARACTER_COUNT) {
    return { content, truncated: false, includedPaths, warnings };
  }
  return {
    content: truncateDisplay(content, MAX_MEMORY_CHARACTER_COUNT),
    truncated: true,
    includedPaths,
    warnings: [...warnings, `memory rules truncated at ${MAX_MEMORY_CHARACTER_COUNT} chars`],
  };
}

export function parseMemoryRuleFrontmatter(content: string): MemoryRuleFrontmatter {
  const match = /^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n?/u.exec(content);
  if (!match?.groups?.frontmatter) {
    return { paths: [], body: content };
  }
  const paths: string[] = [];
  for (const line of match.groups.frontmatter.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("paths:")) {
      const inline = trimmed.slice("paths:".length).trim();
      if (inline.startsWith("[") && inline.endsWith("]")) {
        paths.push(
          ...inline
            .slice(1, -1)
            .split(",")
            .map((item) => cleanFrontmatterPath(item))
            .filter(Boolean),
        );
      }
      continue;
    }
    if (trimmed.startsWith("- ")) {
      paths.push(cleanFrontmatterPath(trimmed.slice(2)));
    }
  }
  return { paths: [...new Set(paths)], body: content.slice(match[0].length) };
}

export function shouldApplyMemoryRule(paths: string[], changedPaths: string[]): boolean {
  if (paths.length === 0) return true;
  return changedPaths.some((file) => paths.some((pattern) => globLikeMatch(pattern, file)));
}

async function loadMemoryFileRecursive(
  root: string,
  path: string,
  seen: Set<string>,
  depth: number,
  includedPaths: string[],
  warnings: string[],
): Promise<string> {
  const resolved = resolve(path);
  if (!isInside(dirname(root), resolved) && resolved !== root) {
    warnings.push(`include skipped outside project rules directory: ${relative(dirname(root), resolved)}`);
    return "";
  }
  if (seen.has(resolved)) {
    warnings.push(`include cycle skipped: ${relative(dirname(root), resolved)}`);
    return "";
  }
  if (depth > MAX_INCLUDE_DEPTH) {
    warnings.push(`include depth limit reached at ${relative(dirname(root), resolved)}`);
    return "";
  }
  seen.add(resolved);
  includedPaths.push(resolved);
  const raw = await readFile(resolved, "utf8");
  const withIncludes = await replaceIncludes(root, resolved, raw, seen, depth, includedPaths, warnings);
  return withIncludes;
}

async function replaceIncludes(
  root: string,
  currentPath: string,
  content: string,
  seen: Set<string>,
  depth: number,
  includedPaths: string[],
  warnings: string[],
): Promise<string> {
  const lines = content.split(/\r?\n/u);
  const output: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*@include\s+(.+?)\s*$/u);
    if (!match?.[1]) {
      output.push(line);
      continue;
    }
    const includePath = resolve(dirname(currentPath), match[1].trim());
    const included = await loadMemoryFileRecursive(root, includePath, seen, depth + 1, includedPaths, warnings);
    output.push(included);
  }
  return output.join("\n");
}

function cleanFrontmatterPath(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function globLikeMatch(pattern: string, file: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const normalizedFile = file.replaceAll("\\", "/");
  const optionalDoubleStarSlash = normalizedPattern.startsWith("**/");
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  const source = optionalDoubleStarSlash ? escaped.replace(/^\.\*\//u, "(?:.*/)?") : escaped;
  const nestedOptional = source.replace(/\/\.\*\//gu, "/(?:.*/)?");
  return new RegExp(`^${nestedOptional}$`, "u").test(normalizedFile);
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
