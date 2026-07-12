import { readdir } from "node:fs/promises";
import { describe, it } from "vitest";
import {
  commitFailureLearningInput,
  createFailureLearningState,
  loadFailureRecords,
} from "./failure-learning-runtime.js";

describe.skipIf(!process.env.LINGHUN_FAILURE_STRESS_DIR)(
  "failure learning cross-process harness",
  () => {
    it("runs the isolated worker", async () => {
      const state = createFailureLearningState("stress-project");
      state.directory = process.env.LINGHUN_FAILURE_STRESS_DIR!;
      state.projectScope = "stress-project";
      if (process.env.LINGHUN_FAILURE_STRESS_ROLE === "verify") {
        const records = await loadFailureRecords(state);
        if (records.length !== 1 || records[0].count !== 2_000) {
          throw new Error(`unexpected cross-process count: ${JSON.stringify(records)}`);
        }
        const entries = await readdir(state.directory);
        const jsonFiles = entries.filter((file) => file.endsWith(".json"));
        if (jsonFiles.length !== 1) {
          throw new Error(`unexpected cross-process file count: ${jsonFiles.length}`);
        }
        const residues = entries.filter(
          (file) => file.startsWith(".write.lock") || file.includes(".tmp-") || file.includes(".bak-"),
        );
        if (residues.length > 0) {
          throw new Error(`unexpected cross-process residue: ${residues.join(",")}`);
        }
        return;
      }

      for (let index = 0; index < 1_000; index += 1) {
        const result = await commitFailureLearningInput(state, {
          category: "tool_failure",
          failureSummary: "cross-process Bash failure at line 42",
          rootCauseGuess: "synthetic stress input",
          avoidNextTime: "use the focused command",
          sourceRef: `stress:${process.pid}:${index}`,
          relatedTarget: "Bash",
        });
        if (result.status !== "committed") throw new Error("cross-process commit became stale");
      }
    }, 60_000);
  },
);
