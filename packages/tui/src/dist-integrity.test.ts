/**
 * dist-integrity.test.ts — Verifies that all relative imports in dist/index.js
 * resolve to existing files. Prevents ERR_MODULE_NOT_FOUND at startup.
 *
 * Run after build: corepack pnpm exec vitest run packages/tui/src/dist-integrity.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

function extractRelativeImports(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  const imports: string[] = [];
  // Match: from "./something.js" or from './something.js'
  const re = /from\s+["'](\.[^"']+)["']/g;
  for (let match = re.exec(content); match !== null; match = re.exec(content)) {
    if (match[1]) imports.push(match[1]);
  }
  // Match: import("./something.js") dynamic imports
  const dynRe = /import\(["'](\.[^"']+)["']\)/g;
  for (let match = dynRe.exec(content); match !== null; match = dynRe.exec(content)) {
    if (match[1]) imports.push(match[1]);
  }
  return imports;
}

describe("dist integrity", () => {
  it("dist/index.js exists after build", () => {
    const indexJs = join(distDir, "index.js");
    expect(existsSync(indexJs)).toBe(true);
  });

  it("all relative imports in dist/index.js resolve to existing files", () => {
    const indexJs = join(distDir, "index.js");
    if (!existsSync(indexJs)) return; // skip if not built
    const imports = extractRelativeImports(indexJs);
    expect(imports.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const rel of imports) {
      const resolved = join(distDir, rel);
      if (!existsSync(resolved)) {
        missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });

  it("all relative imports in dist/index-runtime.js resolve to existing files", () => {
    const runtimeJs = join(distDir, "index-runtime.js");
    if (!existsSync(runtimeJs)) return; // skip if not built
    const imports = extractRelativeImports(runtimeJs);
    const missing: string[] = [];
    for (const rel of imports) {
      const resolved = join(distDir, rel);
      if (!existsSync(resolved)) {
        missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });

  it("dist/index.js can be dynamically imported without ERR_MODULE_NOT_FOUND", async () => {
    const indexJs = join(distDir, "index.js");
    if (!existsSync(indexJs)) return; // skip if not built
    // Only test that the module graph resolves; don't execute side effects
    await expect(import(indexJs)).resolves.toBeDefined();
  }, 30_000);
});
