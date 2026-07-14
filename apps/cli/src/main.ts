#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli.js";

export { runCli };

if (isDirectCliEntry()) {
  const controller = new AbortController();
  const handleSigint = () => controller.abort("SIGINT");
  process.once("SIGINT", handleSigint);
  const result = await runCli(process.argv.slice(2), controller.signal).finally(() => {
    process.removeListener("SIGINT", handleSigint);
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exitCode = result.exitCode;
}

function isDirectCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
