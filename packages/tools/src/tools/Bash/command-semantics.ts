/**
 * Command exit-code semantics: certain commands use non-zero exit codes
 * for non-error outcomes (grep exit 1 = no matches, diff exit 1 = files differ).
 * This module interprets exit codes per command to avoid false-positive "error" signals.
 */

export type CommandInterpretation = {
  isError: boolean;
  message?: string;
};

const GREP_LIKE = new Set(["grep", "rg", "egrep", "fgrep", "ag", "ack"]);
const DIFF_LIKE = new Set(["diff", "colordiff", "icdiff"]);
const TEST_LIKE = new Set(["test", "["]);
const FIND_LIKE = new Set(["find", "fd"]);

function extractLastCommand(command: string): string {
  const segments = command.split(/\s*(?:\|\|?|&&|;)\s*/);
  const last = (segments[segments.length - 1] ?? "").trimStart();
  const envPrefixStripped = last.replace(/^(?:\w+=\S+\s+)+/, "");
  const first = envPrefixStripped.split(/\s/)[0] ?? "";
  const base = first.replace(/^.*[\\/]/, "");
  return base.toLowerCase();
}

export function interpretCommandResult(
  command: string,
  exitCode: number,
): CommandInterpretation {
  if (exitCode === 0) return { isError: false };

  const cmd = extractLastCommand(command);

  if (GREP_LIKE.has(cmd)) {
    if (exitCode === 1) return { isError: false, message: "no matches found" };
    return { isError: true, message: `${cmd} error (exit ${exitCode})` };
  }

  if (DIFF_LIKE.has(cmd)) {
    if (exitCode === 1) return { isError: false, message: "files differ" };
    return { isError: true, message: `${cmd} error (exit ${exitCode})` };
  }

  if (TEST_LIKE.has(cmd)) {
    if (exitCode === 1) return { isError: false, message: "condition false" };
    return { isError: true, message: `${cmd} error (exit ${exitCode})` };
  }

  if (FIND_LIKE.has(cmd)) {
    if (exitCode === 1) return { isError: false, message: "partial results" };
    return { isError: true, message: `${cmd} error (exit ${exitCode})` };
  }

  return { isError: true };
}
