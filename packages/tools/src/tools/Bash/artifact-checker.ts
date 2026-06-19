import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import type { ReadSnapshot, ToolContext, ToolOutput } from "../../index.js";

export type BashArtifactCheckInput = {
  path: string;
  expectHeader?: string;
  expectMagic?: string;
  json?: boolean;
  executable?: boolean;
  protectPaths?: string[];
};

type ArtifactDiagnostic = {
  type: "artifact_preservation" | "missing_command";
  severity: "recoverable" | "blocking";
  evidence: string;
  suggestion: string;
};

type ResolvedArtifactPath = {
  input: string;
  absolute: string;
  relative: string;
};

type ArtifactCheckOptions = {
  input: BashArtifactCheckInput;
  target: ResolvedArtifactPath;
  protectPaths: ResolvedArtifactPath[];
  context: ToolContext;
};

export async function checkArtifact(input: ArtifactCheckOptions): Promise<ToolOutput> {
  const diagnostics: ArtifactDiagnostic[] = [];
  const protectedFiles = [];
  let artifact;

  try {
    const info = await stat(input.target.absolute);
    const isFile = info.isFile();
    const isDirectory = info.isDirectory();
    const content = isFile ? await readFile(input.target.absolute) : Buffer.alloc(0);
    const sha256 = isFile ? hashBuffer(content) : undefined;
    const checks = {
      header: checkHeader(content, input.input.expectHeader ?? input.input.expectMagic),
      json: input.input.json ? checkJson(content) : undefined,
      executable: input.input.executable ? await checkExecutable(input.target.absolute) : undefined,
    };
    artifact = {
      path: input.target.relative,
      exists: true,
      isFile,
      isDirectory,
      size: info.size,
      sha256,
      permissions: {
        mode: `0o${(info.mode & 0o777).toString(8)}`,
        executable: await canExecute(input.target.absolute),
      },
      checks,
    };
    addCheckDiagnostics(diagnostics, input.target.relative, checks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addDiagnostic(
      diagnostics,
      "artifact_preservation",
      "blocking",
      `artifact missing or unreadable ${input.target.relative}: ${message}`,
      "Verify the artifact path and preserve expected outputs before retrying.",
    );
    artifact = {
      path: input.target.relative,
      exists: false,
      error: message,
    };
  }

  for (const protectedPath of input.protectPaths) {
    const result = await checkProtectedPath(protectedPath, input.context);
    protectedFiles.push(result);
    if (result.modified) {
      addDiagnostic(
        diagnostics,
        "artifact_preservation",
        "blocking",
        `protected input modified ${result.path}`,
        "Restore or intentionally account for protected input files before continuing.",
      );
    }
  }

  const text = [
    `Artifact check ${input.target.relative}`,
    `exists ${artifact.exists ? "yes" : "no"}`,
    "size" in artifact && typeof artifact.size === "number" ? `size ${artifact.size}` : "",
    "sha256" in artifact && typeof artifact.sha256 === "string" ? `sha256 ${artifact.sha256}` : "",
    formatCheckSummary("header", artifact.checks?.header),
    formatCheckSummary("json", artifact.checks?.json),
    formatCheckSummary("executable", artifact.checks?.executable),
    ...protectedFiles.map((item) => `protect ${item.path} ${item.modified ? "modified" : "clean"}`),
    diagnostics.length > 0 ? `diagnostics ${diagnostics.length}` : "",
  ].filter(Boolean).join("\n");

  return {
    text,
    data: {
      exitCode: diagnostics.some((item) => item.severity === "blocking") ? 1 : 0,
      outcome: diagnostics.length > 0 ? "artifact_check_failed" : "artifact_checked",
      artifact,
      protectPaths: protectedFiles,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    },
  };
}

function checkHeader(content: Buffer, expected: string | undefined) {
  if (expected === undefined) return undefined;
  const actual = content.subarray(0, Buffer.byteLength(expected)).toString("utf8");
  return {
    ok: actual === expected,
    expected,
    actual,
  };
}

function checkJson(content: Buffer) {
  try {
    JSON.parse(content.toString("utf8"));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkExecutable(path: string) {
  return { ok: await canExecute(path) };
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkProtectedPath(path: ResolvedArtifactPath, context: ToolContext) {
  try {
    const content = await readFile(path.absolute);
    const sha256 = hashBuffer(content);
    const snapshot = context.readSnapshots?.[path.relative] as ReadSnapshot | undefined;
    const changed = context.changedFiles.includes(path.relative);
    const modified = snapshot ? snapshot.hash !== hashText(content.toString("utf8")) : changed;
    return {
      path: path.relative,
      exists: true,
      size: content.length,
      sha256,
      modified,
      baseline: snapshot ? "readSnapshot" : changed ? "changedFiles" : "none",
    };
  } catch (error) {
    return {
      path: path.relative,
      exists: false,
      modified: true,
      error: error instanceof Error ? error.message : String(error),
      baseline: "missing",
    };
  }
}

function addCheckDiagnostics(
  diagnostics: ArtifactDiagnostic[],
  path: string,
  checks: {
    header?: { ok: boolean; expected: string; actual: string };
    json?: { ok: boolean; error?: string };
    executable?: { ok: boolean };
  },
): void {
  if (checks.header && !checks.header.ok) {
    addDiagnostic(
      diagnostics,
      "artifact_preservation",
      "blocking",
      `wrong header ${path}: expected ${checks.header.expected}`,
      "Preserve the expected artifact format and regenerate only the output if needed.",
    );
  }
  if (checks.json && !checks.json.ok) {
    addDiagnostic(
      diagnostics,
      "artifact_preservation",
      "blocking",
      `output format mismatch ${path}: invalid JSON`,
      "Fix the artifact format before verification.",
    );
  }
  if (checks.executable && !checks.executable.ok) {
    addDiagnostic(
      diagnostics,
      "artifact_preservation",
      "blocking",
      `permission denied ${path}: executable bit is not set`,
      "Set executable permission when the artifact is expected to run.",
    );
  }
}

function addDiagnostic(
  diagnostics: ArtifactDiagnostic[],
  type: ArtifactDiagnostic["type"],
  severity: ArtifactDiagnostic["severity"],
  evidence: string,
  suggestion: string,
): void {
  diagnostics.push({ type, severity, evidence, suggestion });
}

function formatCheckSummary(name: string, check: { ok: boolean } | undefined): string {
  if (!check) return "";
  return `${name} ${check.ok ? "ok" : "failed"}`;
}

function hashBuffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function hashText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
