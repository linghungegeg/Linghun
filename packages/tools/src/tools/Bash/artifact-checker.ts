import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parse, parseFragment } from "parse5";
import type { ReadSnapshot, ToolContext, ToolOutput } from "../../index.js";

export type BashArtifactCheckInput = {
  path: string;
  expectHeader?: string;
  expectMagic?: string;
  json?: boolean;
  executable?: boolean;
  protectPaths?: string[];
  text?: {
    exact?: string;
    contains?: string | string[];
    lineSet?: string[];
  };
  preserve?: {
    mode: "rawPreserve" | "compareNormalizedHtml";
    expectedPath?: string;
    expectedText?: string;
  };
};

type ArtifactDiagnostic = {
  type: "artifact_preservation" | "missing_command";
  severity: "recoverable" | "blocking";
  evidence: string;
  suggestion: string;
  path?: string;
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
      text: checkText(content, input.input.text),
      preserve: await checkPreserve(content, input.input.preserve, input.context),
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
      input.target.relative,
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
        result.path,
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
    formatCheckSummary("text", artifact.checks?.text),
    formatCheckSummary("preserve", artifact.checks?.preserve),
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

function checkText(content: Buffer, expected: BashArtifactCheckInput["text"]) {
  if (!expected) return undefined;
  const actual = content.toString("utf8");
  const contains = normalizeStringList(expected.contains);
  const exact = expected.exact === undefined ? undefined : actual === expected.exact;
  const missingContains = contains.filter((item) => !actual.includes(item));
  const lines = new Set(actual.split(/\r?\n/u));
  const missingLines = (expected.lineSet ?? []).filter((line) => !lines.has(line));
  return {
    ok: exact !== false && missingContains.length === 0 && missingLines.length === 0,
    ...(expected.exact !== undefined ? { exact: { ok: exact === true } } : {}),
    ...(contains.length > 0 ? { contains: { ok: missingContains.length === 0, missing: missingContains } } : {}),
    ...(expected.lineSet && expected.lineSet.length > 0
      ? { lineSet: { ok: missingLines.length === 0, missing: missingLines } }
      : {}),
  };
}

async function checkPreserve(
  content: Buffer,
  preserve: BashArtifactCheckInput["preserve"],
  context: ToolContext,
) {
  if (!preserve) return undefined;
  const actual = content.toString("utf8");
  const expected = await readPreserveExpected(preserve, context);
  if (expected.error) return { ok: false, error: expected.error };
  const expectedText = expected.text ?? "";
  const ok = preserve.mode === "rawPreserve"
    ? actual === expectedText
    : canonicalizeHtmlForPreserve(actual) === canonicalizeHtmlForPreserve(expectedText);
  return { ok, mode: preserve.mode };
}

async function readPreserveExpected(
  preserve: NonNullable<BashArtifactCheckInput["preserve"]>,
  context: ToolContext,
): Promise<{ text?: string; error?: string }> {
  if (preserve.expectedText !== undefined) return { text: preserve.expectedText };
  if (!preserve.expectedPath) return { error: "preserve expectedPath or expectedText is required" };
  try {
    const target = resolve(context.workspaceRoot, preserve.expectedPath);
    const rel = relative(context.workspaceRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return { error: `path outside workspace: ${preserve.expectedPath}` };
    }
    return { text: await readFile(target, "utf8") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeStringList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function canonicalizeHtmlForPreserve(value: string): string {
  const normalized = value.replace(/\r\n/gu, "\n");
  const document = parse(normalized) as HtmlNode;
  const fragment = parseFragment(normalized) as HtmlNode;
  const documentSemantic = canonicalizeHtmlDocument(document);
  const fragmentSemantic = canonicalizeHtmlFragment(fragment);
  return [
    documentSemantic,
    fragmentSemantic === documentSemantic ? "" : fragmentSemantic,
  ].join("\n---fragment---\n");
}

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  data?: string;
  name?: string;
  publicId?: string;
  systemId?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
};

const RAW_TEXT_PRESERVE_TAGS = new Set(["script", "style", "pre", "textarea"]);

function canonicalizeHtmlNode(node: HtmlNode, parentTag = ""): string {
  const nodeName = node.nodeName ?? "";
  if (nodeName === "#text") {
    const text = RAW_TEXT_PRESERVE_TAGS.has(parentTag)
      ? node.value ?? ""
      : normalizeHtmlText(node.value ?? "");
    return text ? `text:${text}` : "";
  }
  if (nodeName === "#comment") return `comment:${node.data ?? ""}`;
  if (nodeName === "#documentType") {
    return `doctype:${node.name ?? "html"}:${node.publicId ?? ""}:${node.systemId ?? ""}`;
  }

  const tag = (node.tagName ?? nodeName).toLowerCase();
  const attrs = (node.attrs ?? [])
    .map((attr) => `${attr.name.toLowerCase()}=${JSON.stringify(normalizeHtmlText(attr.value))}`)
    .sort()
    .join(",");
  const children = (node.childNodes ?? [])
    .map((child) => canonicalizeHtmlNode(child, tag))
    .filter(Boolean)
    .join("");
  return `<${tag}${attrs ? ` ${attrs}` : ""}>${children}</${tag}>`;
}

function canonicalizeHtmlDocument(document: HtmlNode): string {
  const html = findChild(document, "html");
  if (!html) return canonicalizeHtmlChildren(document.childNodes ?? []);
  const head = findChild(html, "head");
  const body = findChild(html, "body");
  return [
    canonicalizeHtmlChildren(head?.childNodes ?? []),
    canonicalizeHtmlChildren(body?.childNodes ?? []),
  ].filter(Boolean).join("");
}

function canonicalizeHtmlFragment(fragment: HtmlNode): string {
  const children = (fragment.childNodes ?? []).filter((child) => child.nodeName !== "#documentType");
  const html = children.find((child) => (child.tagName ?? child.nodeName ?? "").toLowerCase() === "html");
  if (!html) return canonicalizeHtmlChildren(children);
  const head = findChild(html, "head");
  const body = findChild(html, "body");
  return [
    canonicalizeHtmlChildren(head?.childNodes ?? []),
    canonicalizeHtmlChildren(body?.childNodes ?? []),
  ].filter(Boolean).join("");
}

function canonicalizeHtmlChildren(children: HtmlNode[]): string {
  return children.map((child) => canonicalizeHtmlNode(child)).filter(Boolean).join("");
}

function findChild(node: HtmlNode, name: string): HtmlNode | undefined {
  return (node.childNodes ?? []).find((child) => (child.tagName ?? child.nodeName ?? "").toLowerCase() === name);
}

function normalizeHtmlText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
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
    text?: { ok: boolean; contains?: { missing: string[] }; lineSet?: { missing: string[] }; exact?: { ok: boolean } };
    preserve?: { ok: boolean; mode?: string; error?: string };
  },
): void {
  if (checks.header && !checks.header.ok) {
    addDiagnostic(
      diagnostics,
      "artifact_preservation",
      "blocking",
      `wrong header ${path}: expected ${checks.header.expected}`,
      "Preserve the expected artifact format and regenerate only the output if needed.",
      path,
    );
  }
  if (checks.json && !checks.json.ok) {
    addDiagnostic(
      diagnostics,
      "artifact_preservation",
      "blocking",
      `output format mismatch ${path}: invalid JSON`,
      "Fix the artifact format before verification.",
      path,
    );
  }
  if (checks.executable && !checks.executable.ok) {
    addDiagnostic(
      diagnostics,
      "artifact_preservation",
      "blocking",
      `permission denied ${path}: executable bit is not set`,
      "Set executable permission when the artifact is expected to run.",
      path,
    );
  }
  if (checks.text && !checks.text.ok) {
    const missing = [
      ...(checks.text.contains?.missing ?? []),
      ...(checks.text.lineSet?.missing ?? []),
    ];
    addDiagnostic(
      diagnostics,
      "artifact_preservation",
      "blocking",
      `text expectation mismatch ${path}${missing.length > 0 ? `: missing ${missing.join(", ")}` : ""}`,
      "Update the artifact so the explicitly requested text expectations pass.",
      path,
    );
  }
  if (checks.preserve && !checks.preserve.ok) {
    addDiagnostic(
      diagnostics,
      "artifact_preservation",
      "blocking",
      `preservation mismatch ${path}${checks.preserve.mode ? ` mode=${checks.preserve.mode}` : ""}`,
      "Preserve the explicitly requested source content or confirm intentional changes before continuing.",
      path,
    );
  }
}

function addDiagnostic(
  diagnostics: ArtifactDiagnostic[],
  type: ArtifactDiagnostic["type"],
  severity: ArtifactDiagnostic["severity"],
  evidence: string,
  suggestion: string,
  path?: string,
): void {
  diagnostics.push({ type, severity, evidence, suggestion, ...(path ? { path } : {}) });
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
