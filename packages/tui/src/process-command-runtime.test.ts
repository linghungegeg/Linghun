import { describe, expect, it } from "vitest";
import { summarizeCommandOutput } from "./process-command-runtime.js";

describe("process command runtime", () => {
  it("filters codebase-memory startup diagnostics from command summaries", () => {
    expect(
      summarizeCommandOutput(
        "level=info msg=mem.init budget_mb=16269 total_ram_mb=32538\npattern is required\n",
        "exit 1",
      ),
    ).toBe("pattern is required");
  });

  it("keeps diagnostic output when it is the only available command output", () => {
    expect(
      summarizeCommandOutput("level=info msg=mem.init budget_mb=16269 total_ram_mb=32538\n", "exit 1"),
    ).toContain("mem.init");
  });
});
