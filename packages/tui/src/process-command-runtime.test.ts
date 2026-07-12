import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommandCapture, summarizeCommandOutput } from "./process-command-runtime.js";

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

  it("terminates an owned command before its delayed side effect after abort", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "linghun-command-abort-"));
    const marker = join(cwd, "late-side-effect.txt");
    const controller = new AbortController();
    const running = runCommandCapture(
      process.execPath,
      [
        "-e",
        `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 1000); setTimeout(() => {}, 5000);`,
      ],
      cwd,
      10_000,
      controller.signal,
    );
    setTimeout(() => controller.abort("test abort"), 50);

    await expect(running).resolves.toMatchObject({ exitCode: 130, errorCode: "ABORTED" });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  }, 5_000);
});
