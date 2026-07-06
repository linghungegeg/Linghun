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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  "model-command-runtime.ts": ["await formatModelRouteDoctor", "formatModelRoutes(context.config)"],
  "mcp-index-runtime.ts": ["formatMcpStatus(context)", "validateMcpServers(context, args[1])"],
  "memory-command-runtime.ts": [
    "formatMemoryStorage(context)",
    "formatMemoryReview(context)",
    "formatMemoryStats(context)",
    "formatMemoryLearningRun(result, context.language)",
  ],
  "job-agent-command-runtime.ts": [
    "formatJobStatus(job, context.language)",
    "formatJobReport(job, context.language)",
    "await formatJobLogs(job, context.language)",
    "formatAgentDetails(agent, context)",
    "formatAgentsList(context)",
  ],
  "remote-command-runtime.ts": ["formatRemoteTestResult(channel, result)"],
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

  it("routes /skills and /plugins doctor/validate bodies through definition-backed panel details", () => {
    const src = readSrc("extension-slash-runtime.ts");
    expect(src).toContain('doctorDetails: (context) => validateExtensionItems("skills", context)');
    expect(src).toContain("doctorDetails: formatPluginsDoctor");
    expect(src).toContain("? definition.doctorDetails(context)");
    expect(src).toContain(": validateExtensionItems(definition.kind, context, args[1])");
    expect(src).not.toContain("writeLine(output, validateExtensionItems");
    expect(src).not.toContain("writeLine(output, formatPluginsDoctor");
  });

  it("keeps /remote setup in CommandPanel with legacy details compatibility", () => {
    const src = readSrc("remote-command-runtime.ts");
    expect(src).toContain('title: "/remote setup"');
    expect(src).toContain("detailsText: [");
    expect(src).toContain("formatRemoteBotSetupDetails(context, args[1])");
    expect(src).toContain("Legacy /remote setup details（compatibility）");
    expect(src).toContain("formatRemoteSetup(args[1], context)");
    expect(src).not.toContain("writeLine(output, formatRemoteSetup(args[1], context)");
  });

  it("keeps /index progress out of ordinary output blocks", () => {
    // runIndexRepository progress is an activity/background state, not a
    // long-lived ordinary output block.
    const src = readSrc("mcp-index-runtime.ts");
    expect(src).not.toContain('writeLine(output, "Index: scanning safety risks...');
    expect(src).not.toContain("`Index ${actionLabel}: running...`");
    expect(src).not.toContain(
      '`索引${actionLabel === "refresh" ? "刷新" : "初始化"}：正在执行...`',
    );
  });
});
