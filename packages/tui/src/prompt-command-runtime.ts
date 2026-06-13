import type { Language } from "@linghun/shared";

export type PromptCommandHandler = {
  name: string;
  promptCommand: true;
  description: string;
  buildPrompt(args: string[], language: Language): string;
};

export type CommandHandler = PromptCommandHandler;

export const PROMPT_COMMANDS: Record<string, CommandHandler> = {
  "/commit": {
    name: "/commit",
    promptCommand: true,
    description: "Ask the model to review the current git diff and prepare a safe commit plan.",
    buildPrompt: (args, language) =>
      createPromptCommandText(
        language,
        "/commit",
        args,
        [
          "Inspect git status and diff before making any claim.",
          "Summarize changed files and risk.",
          "Suggest a concise commit message.",
          "Only run git commit if the user explicitly confirms and permissions allow it.",
        ],
      ),
  },
  "/init": {
    name: "/init",
    promptCommand: true,
    description: "Ask the model to explore the project and draft Linghun project instructions.",
    buildPrompt: (args, language) =>
      createPromptCommandText(
        language,
        "/init",
        args,
        [
          "Ask for scope if the target instructions file or project boundary is unclear.",
          "Explore the repository structure with read/search tools.",
          "Draft minimal project instructions aligned with existing style.",
          "Write files only after evidence and permission approval.",
          "Summarize created or updated files and validation gaps.",
        ],
      ),
  },
  "/security-review": {
    name: "/security-review",
    promptCommand: true,
    description: "Ask the model to review git diff for security risks and produce a report.",
    buildPrompt: (args, language) =>
      createPromptCommandText(
        language,
        "/security-review",
        args,
        [
          "Collect git diff and relevant changed files.",
          "Check for SQL injection, XSS, RCE, path traversal, auth bypass, secret leakage, and unsafe deserialization.",
          "Separate confirmed findings from false positives and uncertain risks.",
          "Produce a Markdown report in the answer unless the user explicitly asks to write a file.",
        ],
      ),
  },
  "/commit-push-pr": {
    name: "/commit-push-pr",
    promptCommand: true,
    description: "Ask the model to guide branch, commit, push, and PR creation.",
    buildPrompt: (args, language) =>
      createPromptCommandText(
        language,
        "/commit-push-pr",
        args,
        [
          "Inspect git status, branch, remotes, and available gh CLI before acting.",
          "Create or reuse a safe branch only with user approval.",
          "Commit, push, and create a PR only through explicit tool calls and permission gates.",
          "Use heredoc or file-based bodies for long commit/PR text to avoid shell quoting mistakes.",
          "Report exact commands run and any blocked step.",
        ],
      ),
  },
  "/init-verifiers": {
    name: "/init-verifiers",
    promptCommand: true,
    description: "Ask the model to design project-specific verification helpers.",
    buildPrompt: (args, language) =>
      createPromptCommandText(
        language,
        "/init-verifiers",
        args,
        [
          "Detect the project language, package manager, and existing verification scripts.",
          "Prefer existing scripts before proposing new tools.",
          "Ask before installing dependencies or changing config.",
          "If creating verifier instructions, keep them minimal and project-specific.",
          "Summarize runnable verification commands and remaining gaps.",
        ],
      ),
  },
};

export function findPromptCommand(command: string): CommandHandler | undefined {
  return PROMPT_COMMANDS[command];
}

export function buildPromptCommandUserText(
  command: string,
  args: string[],
  language: Language,
): string | undefined {
  return PROMPT_COMMANDS[command]?.buildPrompt(args, language);
}

function createPromptCommandText(
  language: Language,
  command: string,
  args: string[],
  steps: string[],
): string {
  const userArgs = args.join(" ").trim() || "(none)";
  const header =
    language === "en-US"
      ? `PromptCommand ${command}: execute through Linghun's normal model/tool loop.`
      : `PromptCommand ${command}：通过 Linghun 现有模型/工具主循环执行。`;
  const constraints =
    language === "en-US"
      ? "Do not bypass Start Gate, Plan, permissions, evidence, or final-answer verification. Do not claim actions were executed until tool results prove them."
      : "不得绕过 Start Gate、Plan、权限、证据或最终回答校验。没有工具结果证明前，不得声称已执行动作。";
  return [
    header,
    `CommandArgs=${userArgs}`,
    constraints,
    "Steps:",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
  ].join("\n");
}
