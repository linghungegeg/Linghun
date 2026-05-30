// D.14D-E — Advanced slash CommandPanel closure invariant.
//
// Locks the migration discipline: the richer advanced-slash subcommands
// (doctor / usage / validate / report / logs / status views) must route their
// large formatXxx bodies through showCommandPanel({ ..., detailsText }) instead
// of dumping them straight into the transcript via a bare writeLine.
//
// In non-ink mode showCommandPanel writes detailsText verbatim, so plain-mode
// output stays byte-identical to the legacy writeLine body; only the Ink main
// screen gains a summary-first card. This static source check catches a future
// regression that reverts a migrated body back to `writeLine(output, formatXxx)`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readSrc(file: string): string {
  return readFileSync(join(here, file), "utf8");
}

// Each entry lists the large formatter call expressions that were migrated in
// the given file. For every call we assert:
//   - it is passed into a showCommandPanel detailsText (`detailsText: <call>`)
//   - it is NOT passed straight into a bare writeLine (`writeLine(output, <call>`)
const MIGRATIONS: Record<string, string[]> = {
  "model-command-runtime.ts": [
    "await formatModelRouteDoctor",
    "formatModelRoutes(context.config)",
  ],
  "mcp-index-runtime.ts": [
    "formatMcpStatus(context)",
    "validateMcpServers(context, args[1])",
  ],
  "memory-command-runtime.ts": [
    "formatMemoryStorage(context)",
    "formatMemoryReview(context)",
    "formatMemoryStats(context)",
    "formatMemoryLearningRun(result, context.language)",
  ],
  "job-agent-command-runtime.ts": [
    "formatJobStatus(job)",
    "formatJobReport(job)",
    "await formatJobLogs(job)",
    "formatAgentDetails(agent, context)",
    "formatAgentsList(context)",
  ],
  "extension-slash-runtime.ts": [
    'validateExtensionItems("skills", context)',
    'validateExtensionItems("skills", context, args[1])',
    "formatPluginsDoctor(context)",
    'validateExtensionItems("plugins", context, args[1])',
  ],
  "remote-command-runtime.ts": [
    "formatRemoteSetup(args[1], context)",
    "formatRemoteTestResult(channel, result)",
  ],
};

describe("D.14D-E advanced slash CommandPanel invariant", () => {
  for (const [file, calls] of Object.entries(MIGRATIONS)) {
    describe(file, () => {
      const src = readSrc(file);

      it("routes migrated bodies through showCommandPanel", () => {
        expect(src).toContain("showCommandPanel");
      });

      for (const call of calls) {
        it(`passes ${call} into detailsText, not a bare writeLine`, () => {
          expect(src).toContain(`detailsText: ${call}`);
          expect(src).not.toContain(`writeLine(output, ${call}`);
        });
      }
    });
  }

  it("routes /remote doctor report into a panel, not a bare writeLine", () => {
    // formatRemoteDoctor is assigned to `report` (also recorded as lastDoctor)
    // before being surfaced; the surface must be the panel detailsText.
    const src = readSrc("remote-command-runtime.ts");
    expect(src).toContain("detailsText: report");
    expect(src).not.toContain("writeLine(output, report)");
  });

  it("does not reroute /index streaming progress through a panel", () => {
    // runIndexRepository streams progress lines; these must stay on writeLine
    // and never be wrapped in a showCommandPanel call.
    const src = readSrc("mcp-index-runtime.ts");
    expect(src).toMatch(/writeLine\(\s*\n?\s*output,\s*\n?\s*context\.language === "en-US"\s*\n?\s*\? `Index \$\{actionLabel\}: running\.\.\.`/);
  });
});
