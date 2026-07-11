#!/usr/bin/env node
import { runCli } from "./cli.js";

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
