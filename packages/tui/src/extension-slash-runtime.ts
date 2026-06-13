import type { Writable } from "node:stream";
import { saveExtensionEnablement } from "@linghun/config";
import { TOGGLE_DETAILS_KEYBIND } from "@linghun/shared";
import { showCommandPanel } from "./command-panel-runtime.js";
import {
  createSkillEvolutionCandidate,
  formatExtensionInstallGate,
  formatExtensionStatus,
  formatPlugins,
  formatPluginsDoctor,
  formatSkills,
  formatTrustNotice,
  installExtensionFromRequest,
  parseExtensionInstallRequest,
  removeExtension,
  updateExtension,
  validateExtensionItems,
} from "./extension-command-runtime.js";
import type { TuiContext } from "./index.js";
import { writeLine } from "./startup-runtime.js";
import type { PluginSummary, SkillSummary } from "./tui-data-types.js";
import { createHookState, createPluginState, createSkillState } from "./tui-state-runtime.js";

type ExtensionKind = "skills" | "plugins";

export type ExtensionSlashRuntimeDeps = {
  appendSystemEvent: (
    context: TuiContext,
    sessionId: string,
    message: string,
    level: "info" | "warning",
  ) => Promise<void>;
  ensureSession: (context: TuiContext) => Promise<string>;
  refreshCacheFreshness: (context: TuiContext) => void;
};

let runtimeDeps: ExtensionSlashRuntimeDeps | undefined;

export function configureExtensionSlashRuntime(deps: ExtensionSlashRuntimeDeps): void {
  runtimeDeps = deps;
}

function deps(): ExtensionSlashRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error("extension-slash-runtime deps not configured");
  }
  return runtimeDeps;
}

type ExtensionCommandDefinition = {
  kind: ExtensionKind;
  title: string;
  projectDir: (context: TuiContext) => string;
  userDir: (context: TuiContext) => string;
  total: (context: TuiContext) => number;
  enabled: (context: TuiContext) => number;
  listDetails: (context: TuiContext) => string;
  doctorDetails: (context: TuiContext) => string;
  installIntro: (context: TuiContext) => string[];
  reload: (context: TuiContext) => Promise<void>;
  trustItem: (context: TuiContext, id: string) => SkillSummary | PluginSummary | undefined;
  trustKind: "skill" | "plugin";
  unknownEnableMessage: (id: string) => string;
  failedEnableMessage?: (id: string) => string;
  usage: string;
  updateUsage: string;
  enabledLabel: string;
  disabledLabel: string;
};

const SKILLS_COMMAND: ExtensionCommandDefinition = {
  kind: "skills",
  title: "/skills",
  projectDir: (context) => context.skills.projectDir,
  userDir: (context) => context.skills.userDir,
  total: (context) => context.skills.skills.length,
  enabled: (context) => context.skills.skills.filter((item) => item.enabled).length,
  listDetails: formatSkills,
  doctorDetails: (context) => validateExtensionItems("skills", context),
  installIntro: (context) => [
    "Skills install（Connect Lite）",
    `- project: ${context.skills.projectDir}`,
    `- user: ${context.skills.userDir}`,
    "- usage: /skills install local <path> [--scope project|user]",
    "- usage: /skills install git <url> [--ref <ref>] --confirm-network",
    "- usage: /skills install github <owner/repo> [--ref <ref>] --confirm-network",
    "- install 前只读取 manifest / SKILL.md / metadata；不执行第三方代码。",
  ],
  reload: async (context) => {
    context.skills = await createSkillState(context.config, context.projectPath);
  },
  trustItem: (context, id) => context.skills.skills.find((item) => item.id === id),
  trustKind: "skill",
  unknownEnableMessage: (id) => `未知 skill：${id}。请先在本地 manifest 注册后再启用。`,
  failedEnableMessage: (id) => `skill manifest 加载失败，不能启用：${id}。请先修复 manifest。`,
  usage:
    "用法：/skills | /skills status|doctor|validate [id] | /skills install local|git|github ... | /skills enable|disable <id> | /skills remove <id> | /skills update <id>",
  updateUsage: "用法：/skills update <id> [--ref <ref>] [--confirm-network]",
  enabledLabel: "skill",
  disabledLabel: "skill",
};

const PLUGINS_COMMAND: ExtensionCommandDefinition = {
  kind: "plugins",
  title: "/plugins",
  projectDir: (context) => context.plugins.projectDir,
  userDir: (context) => context.plugins.userDir,
  total: (context) => context.plugins.plugins.length,
  enabled: (context) => context.plugins.plugins.filter((item) => item.enabled).length,
  listDetails: formatPlugins,
  doctorDetails: formatPluginsDoctor,
  installIntro: (context) => [
    "Plugins install（Connect Lite）",
    `- project: ${context.plugins.projectDir}`,
    `- user: ${context.plugins.userDir}`,
    "- usage: /plugins install local <path> [--scope project|user]",
    "- usage: /plugins install git <url> [--ref <ref>] --confirm-network",
    "- usage: /plugins install github <owner/repo> [--ref <ref>] --confirm-network",
    "- install 前只读取 manifest / metadata；不执行仓库脚本、postinstall、hook 或第三方代码。",
  ],
  reload: async (context) => {
    context.plugins = await createPluginState(context.config, context.projectPath);
    context.hooks = await createHookState(context.config, context.projectPath);
  },
  trustItem: (context, id) => context.plugins.plugins.find((item) => item.id === id),
  trustKind: "plugin",
  unknownEnableMessage: (id) => `未知 plugin：${id}。请先在本地 manifest 注册后再启用。`,
  usage:
    "用法：/plugins | /plugins status|doctor|validate [id] | /plugins install local|git|github ... | /plugins enable|disable <id> | /plugins remove <id> | /plugins update <id>",
  updateUsage: "用法：/plugins update <id> [--ref <ref>] [--confirm-network]",
  enabledLabel: "plugin",
  disabledLabel: "plugin",
};

async function handleExtensionCommonCommand(
  definition: ExtensionCommandDefinition,
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<boolean> {
  const action = args[0];
  if (!action) {
    const isEn = context.language === "en-US";
    const total = definition.total(context);
    const enabled = definition.enabled(context);
    showCommandPanel(context, output, {
      title: definition.title,
      tone: "neutral",
      summary: [
        isEn
          ? `${definition.title.slice(1, 2).toUpperCase()}${definition.title.slice(2)} · ${total} total · ${enabled} enabled`
          : `${definition.kind === "skills" ? "技能" : "插件"} · 共 ${total} · 启用 ${enabled}`,
      ],
      actions: [`${definition.title} status`, `${definition.title} doctor`],
      detailsText: definition.listDetails(context),
    });
    return true;
  }
  if (action === "status") {
    showCommandPanel(context, output, {
      title: `${definition.title} status`,
      tone: "neutral",
      summary: [],
      detailsText: formatExtensionStatus(definition.kind, context),
    });
    return true;
  }
  if (action === "doctor" || action === "validate") {
    const label = action === "doctor" ? "doctor" : "validate";
    showCommandPanel(context, output, {
      title: `${definition.title} ${label}`,
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? `${definition.kind === "skills" ? "Skills" : "Plugins"} ${label} — ${TOGGLE_DETAILS_KEYBIND} for details.`
          : `${definition.kind === "skills" ? "技能" : "插件"}${label === "doctor" ? "诊断" : "校验"} — ${TOGGLE_DETAILS_KEYBIND} 查看详情。`,
      ],
      detailsText:
        action === "doctor"
          ? definition.doctorDetails(context)
          : validateExtensionItems(definition.kind, context, args[1]),
    });
    return true;
  }
  if (action === "add" || action === "install") {
    const request = parseExtensionInstallRequest(args.slice(1));
    if (!request) {
      writeLine(output, definition.installIntro(context).join("\n"));
      return true;
    }
    if (request.source !== "local" && !request.confirmNetwork) {
      writeLine(output, formatExtensionInstallGate(definition.kind, request, `${definition.title} install`));
      return true;
    }
    const result = await installExtensionFromRequest(
      definition.kind,
      request,
      context,
      async (summary) => {
        await deps().appendSystemEvent(
          context,
          await deps().ensureSession(context),
          summary,
          "info",
        );
      },
    );
    await definition.reload(context);
    deps().refreshCacheFreshness(context);
    writeLine(output, result.summary);
    return true;
  }
  if (action === "remove") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await removeExtension(definition.kind, id, context).then((summary) => {
            deps().refreshCacheFreshness(context);
            return summary;
          })
        : `用法：${definition.title} remove <id>`,
    );
    return true;
  }
  if (action === "update") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await updateExtension(definition.kind, id, context, args.slice(2), async (summary) => {
            await deps().appendSystemEvent(
              context,
              await deps().ensureSession(context),
              summary,
              "info",
            );
          }).then((summary) => {
            deps().refreshCacheFreshness(context);
            return summary;
          })
        : definition.updateUsage,
    );
    return true;
  }
  if (action === "enable" || action === "disable") {
    const id = args[1];
    if (!id) {
      writeLine(output, `用法：${definition.title} ${action} <id>`);
      return true;
    }
    const item = definition.trustItem(context, id);
    if (action === "enable") {
      if (!item) {
        writeLine(output, definition.unknownEnableMessage(id));
        return true;
      }
      if (item.lastError && definition.failedEnableMessage) {
        writeLine(output, definition.failedEnableMessage(id));
        return true;
      }
      writeLine(output, formatTrustNotice(definition.trustKind, item));
    }
    context.config = await saveExtensionEnablement(
      definition.kind,
      id,
      action === "enable",
      context.projectPath,
    );
    await definition.reload(context);
    writeLine(
      output,
      `${action === "enable" ? "已启用" : "已禁用"} ${definition.disabledLabel}：${id}（状态写入 .linghun/settings.json，重启后保留）`,
    );
    return true;
  }
  return false;
}

export async function handleSkillsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action !== "evolve" && (await handleExtensionCommonCommand(SKILLS_COMMAND, args, context, output))) {
    return;
  }
  if (action === "evolve") {
    const summary = args.slice(1).join(" ").trim();
    if (!summary) {
      writeLine(
        output,
        [
          "Skill evolution candidates（不会自动启用）",
          "- auto enable no; writes files no; trust changes no",
          `- candidates: ${context.skills.evolutionCandidates.length}`,
          ...context.skills.evolutionCandidates.map(
            (item) =>
              `  - ${item.id}: risk ${item.risk}; trigger ${item.triggerCondition}; suggested path ${item.suggestedPath}; summary ${item.summary}`,
          ),
          "- usage: /skills evolve candidate <summary> | /skills evolve reject <id>",
        ].join("\n"),
      );
      return;
    }
    if (args[1] === "reject") {
      const id = args[2];
      const candidate = context.skills.evolutionCandidates.find((item) => item.id === id);
      if (!candidate) {
        writeLine(output, "未找到 skill evolution candidate。用法：/skills evolve reject <id>");
        return;
      }
      context.skills.evolutionCandidates = context.skills.evolutionCandidates.filter(
        (item) => item.id !== id,
      );
      context.skills.rejectedEvolutionCandidates.unshift({ ...candidate, status: "rejected" });
      const sessionId = await deps().ensureSession(context);
      await deps().appendSystemEvent(
        context,
        sessionId,
        `skill evolution: action rejected; id ${candidate.id}; source ${candidate.source}`,
        "info",
      );
      writeLine(output, `已拒绝 skill evolution candidate：${id}；不会生成或启用 skill。`);
      return;
    }
    if (args[1] !== "candidate") {
      writeLine(
        output,
        "用法：/skills evolve | /skills evolve candidate <summary> | /skills evolve reject <id>。不会自动写文件、安装、信任或启用。",
      );
      return;
    }
    const candidateSummary = args.slice(2).join(" ").trim();
    if (!candidateSummary) {
      writeLine(output, "用法：/skills evolve candidate <summary>");
      return;
    }
    const candidate = createSkillEvolutionCandidate(
      candidateSummary,
      "manual /skills evolve candidate",
    );
    context.skills.evolutionCandidates.unshift(candidate);
    const sessionId = await deps().ensureSession(context);
    await deps().appendSystemEvent(
      context,
      sessionId,
      `skill evolution: action candidate; id ${candidate.id}; source ${candidate.source}`,
      "info",
    );
    writeLine(
      output,
      `已创建 skill evolution candidate：${candidate.id}；不会自动写文件、安装、信任或启用。建议路径：${candidate.suggestedPath}`,
    );
    return;
  }
  writeLine(output, SKILLS_COMMAND.usage);
}

export async function handlePluginsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (await handleExtensionCommonCommand(PLUGINS_COMMAND, args, context, output)) {
    return;
  }
  writeLine(output, PLUGINS_COMMAND.usage);
}
