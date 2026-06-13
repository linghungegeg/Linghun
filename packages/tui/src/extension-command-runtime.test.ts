import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinghunConfig } from "@linghun/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatPlugins,
  formatPluginsDoctor,
  formatSkills,
  githubRepoToUrl,
  isGitLocator,
  parseExtensionInstallRequest,
  readExtensionSourceManifest,
  validateExtensionContributionExecution,
  validateExtensionItems,
  updateExtension,
} from "./extension-command-runtime.js";
import type { TuiContext } from "./index.js";
import { createPluginState, createSkillState } from "./tui-state-runtime.js";

describe("extension-command-runtime", () => {
  let tempDir: string;
  let projectPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `linghun-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    projectPath = join(tempDir, "project");
    await mkdir(projectPath, { recursive: true });
    await mkdir(join(projectPath, ".linghun"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("skills manifest loader", () => {
    it("loads valid skill manifest", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "test-skill.json"),
        JSON.stringify({
          id: "test-skill",
          name: "Test Skill",
          description: "A test skill",
          summary: "Test skill summary",
          triggers: ["test", "demo"],
          permissions: ["read", "write"],
          version: "1.0.0",
          source: "local",
        }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);

      expect(state.skills).toHaveLength(1);
      expect(state.skills[0]?.id).toBe("test-skill");
      expect(state.skills[0]?.name).toBe("Test Skill");
      expect(state.skills[0]?.description).toBe("A test skill");
      expect(state.skills[0]?.triggers).toEqual(["demo", "test"]);
      expect(state.skills[0]?.permissions).toEqual(["read", "write"]);
      expect(state.skills[0]?.mayWrite).toBe(true);
      expect(state.skills[0]?.mayExecute).toBe(false);
      expect(state.skills[0]?.mayNetwork).toBe(false);
    });

    it("isolates failed skill manifest", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(join(skillsDir, "broken.json"), "invalid json{", "utf8");

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);

      expect(state.skills).toHaveLength(1);
      expect(state.skills[0]?.id).toBe("broken");
      expect(state.skills[0]?.enabled).toBe(false);
      expect(state.skills[0]?.trusted).toBe(false);
      expect(state.skills[0]?.lastError).toContain("Unexpected token");
      expect(state.skills[0]?.lifecycle.discovered).toBe(false);
      expect(state.skills[0]?.lifecycle.registered).toBe(false);
      expect(state.skills[0]?.lifecycle.schemaLoaded).toBe(false);
    });

    it("handles missing manifest directory", async () => {
      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);
      expect(state.skills).toHaveLength(0);
      expect(state.lastError).toBeUndefined();
    });

    it("sorts skills by id", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "z-skill.json"),
        JSON.stringify({ id: "z-skill", triggers: [], permissions: [] }),
        "utf8",
      );
      await writeFile(
        join(skillsDir, "a-skill.json"),
        JSON.stringify({ id: "a-skill", triggers: [], permissions: [] }),
        "utf8",
      );
      await writeFile(
        join(skillsDir, "m-skill.json"),
        JSON.stringify({ id: "m-skill", triggers: [], permissions: [] }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);

      expect(state.skills.map((s) => s.id)).toEqual(["a-skill", "m-skill", "z-skill"]);
    });

    it("respects disabledIds", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "skill.json"),
        JSON.stringify({ id: "skill", triggers: [], permissions: [] }),
        "utf8",
      );

      const config = createMinimalConfig();
      config.skills.trustedIds.push("skill");
      config.skills.disabledIds.push("skill");
      const state = await createSkillState(config, projectPath);

      expect(state.skills[0]?.enabled).toBe(false);
      expect(state.skills[0]?.trusted).toBe(true);
    });

    it("requires trust for enabled status", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "skill.json"),
        JSON.stringify({ id: "skill", triggers: [], permissions: [], source: "third-party" }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);

      expect(state.skills[0]?.enabled).toBe(false);
      expect(state.skills[0]?.trusted).toBe(false);
    });

    it("loads SKILL.md fallback", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      const skillMdDir = join(skillsDir, "md-skill");
      await mkdir(skillMdDir, { recursive: true });
      await writeFile(
        join(skillMdDir, "SKILL.md"),
        "# Test MD Skill\n\nThis is a markdown-based skill.",
        "utf8",
      );

      const result = await readExtensionSourceManifest("skills", skillMdDir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Test MD Skill");
        expect(result.value.description).toBe("This is a markdown-based skill.");
      }
    });
  });

  describe("plugins manifest loader", () => {
    it("loads valid plugin manifest", async () => {
      const pluginsDir = join(projectPath, ".linghun", "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(
        join(pluginsDir, "test-plugin.json"),
        JSON.stringify({
          id: "test-plugin",
          name: "Test Plugin",
          description: "A test plugin",
          permissions: ["bash", "network"],
          version: "2.0.0",
          source: "official",
          contributions: {
            commands: ["test-cmd"],
            hooks: ["PostToolUse"],
            workflows: ["test-workflow"],
            skills: ["test-skill"],
          },
        }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createPluginState(config, projectPath);

      expect(state.plugins).toHaveLength(1);
      expect(state.plugins[0]?.id).toBe("test-plugin");
      expect(state.plugins[0]?.name).toBe("Test Plugin");
      expect(state.plugins[0]?.source).toBe("official");
      expect(state.plugins[0]?.enabled).toBe(true);
      expect(state.plugins[0]?.trusted).toBe(true);
      expect(state.plugins[0]?.mayWrite).toBe(false);
      expect(state.plugins[0]?.mayExecute).toBe(true);
      expect(state.plugins[0]?.mayNetwork).toBe(true);
      expect(state.plugins[0]?.contributions.commands).toEqual(["test-cmd"]);
      expect(state.plugins[0]?.contributions.hooks).toEqual(["PostToolUse"]);
      expect(state.plugins[0]?.contributions.workflows).toEqual(["test-workflow"]);
      expect(state.plugins[0]?.contributions.skills).toEqual(["test-skill"]);
    });

    it("isolates failed plugin manifest", async () => {
      const pluginsDir = join(projectPath, ".linghun", "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(join(pluginsDir, "broken.json"), "}{invalid", "utf8");

      const config = createMinimalConfig();
      const state = await createPluginState(config, projectPath);

      expect(state.plugins).toHaveLength(1);
      expect(state.plugins[0]?.id).toBe("broken");
      expect(state.plugins[0]?.enabled).toBe(false);
      expect(state.plugins[0]?.trusted).toBe(false);
      expect(state.plugins[0]?.lastError).toBeDefined();
      expect(state.plugins[0]?.lifecycle.discovered).toBe(false);
    });

    it("sorts contributions stably", async () => {
      const pluginsDir = join(projectPath, ".linghun", "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(
        join(pluginsDir, "plugin.json"),
        JSON.stringify({
          id: "plugin",
          permissions: [],
          contributions: {
            commands: ["z-cmd", "a-cmd", "m-cmd"],
            hooks: ["Stop", "Plugin", "Workflow"],
          },
        }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createPluginState(config, projectPath);

      expect(state.plugins[0]?.contributions.commands).toEqual(["a-cmd", "m-cmd", "z-cmd"]);
      expect(state.plugins[0]?.contributions.hooks).toEqual(["Plugin", "Stop", "Workflow"]);
    });

    it("handles empty contributions", async () => {
      const pluginsDir = join(projectPath, ".linghun", "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(
        join(pluginsDir, "minimal.json"),
        JSON.stringify({ id: "minimal", permissions: [] }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createPluginState(config, projectPath);

      expect(state.plugins[0]?.contributions).toEqual({
        commands: [],
        hooks: [],
        mcpServers: [],
        providers: [],
        skills: [],
        workflows: [],
      });
    });
  });

  describe("formatSkills", () => {
    it("shows empty state", () => {
      const context = createMinimalContext();
      const output = formatSkills(context);
      expect(output).toContain("none");
    });

    it("shows skill with error", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(join(skillsDir, "broken.json"), "{bad", "utf8");

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);
      const context = createMinimalContext();
      context.skills = state;

      const output = formatSkills(context);
      expect(output).toContain("last error ");
      expect(output).toContain("disabled");
    });
  });

  describe("formatPlugins", () => {
    it("shows empty state", () => {
      const context = createMinimalContext();
      const output = formatPlugins(context);
      expect(output).toContain("none");
    });

    it("shows plugin with contributions", async () => {
      const pluginsDir = join(projectPath, ".linghun", "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(
        join(pluginsDir, "test.json"),
        JSON.stringify({
          id: "test",
          permissions: [],
          contributions: { commands: ["foo"], hooks: ["Stop"] },
        }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createPluginState(config, projectPath);
      const context = createMinimalContext();
      context.plugins = state;

      const output = formatPlugins(context);
      expect(output).toContain("commands foo");
      expect(output).toContain("hooks Stop");
    });
  });

  describe("formatPluginsDoctor", () => {
    it("reports untrusted plugin", async () => {
      const pluginsDir = join(projectPath, ".linghun", "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(
        join(pluginsDir, "untrusted.json"),
        JSON.stringify({ id: "untrusted", permissions: ["write"], source: "third-party" }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createPluginState(config, projectPath);
      const context = createMinimalContext();
      context.plugins = state;

      const output = formatPluginsDoctor(context);
      expect(output).toContain("BLOCK untrusted");
    });

    it("reports ok for trusted plugin", async () => {
      const pluginsDir = join(projectPath, ".linghun", "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(
        join(pluginsDir, "trusted.json"),
        JSON.stringify({ id: "trusted", permissions: [], source: "official" }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createPluginState(config, projectPath);
      const context = createMinimalContext();
      context.plugins = state;

      const output = formatPluginsDoctor(context);
      expect(output).toContain("trusted: ok");
    });
  });

  describe("validateExtensionItems", () => {
    it("validates missing skill", () => {
      const context = createMinimalContext();
      const output = validateExtensionItems("skills", context, "nonexistent");
      expect(output).toContain("未找到 skill");
    });

    it("validates untrusted skill", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "test.json"),
        JSON.stringify({ id: "test", triggers: [], permissions: [], source: "third-party" }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);
      const context = createMinimalContext();
      context.skills = state;

      const output = validateExtensionItems("skills", context, "test");
      expect(output).toContain("untrusted");
    });

    it("validates ok skill", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "test.json"),
        JSON.stringify({ id: "test", triggers: [], permissions: [], source: "official" }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);
      const context = createMinimalContext();
      context.skills = state;

      const output = validateExtensionItems("skills", context, "test");
      expect(output).toContain("ok");
    });
  });

  describe("updateExtension", () => {
    it("returns an actionable error when --ref has no value", async () => {
      const context = createMinimalContext();
      context.skills.skills = [
        {
          id: "test",
          name: "Test",
          description: "Test skill",
          triggers: [],
          summary: "Test skill",
          source: "third-party",
          scope: "project",
          path: join(projectPath, ".linghun", "skills", "test.json"),
          version: "1.0.0",
          enabled: true,
          trusted: true,
          permissions: [],
          mayWrite: false,
          mayExecute: false,
          mayNetwork: false,
          lifecycle: {
            sourceUrl: "https://example.com/repo.git",
            ref: "main",
            trustLevel: "trusted",
            permissionSummary: "read",
            discovered: true,
            registered: true,
            schemaLoaded: true,
            runtimeVersion: "compatible",
          },
        },
      ];

      const result = await updateExtension("skills", "test", context, ["--ref"]);

      expect(result).toContain("--ref 需要提供非空 ref");
    });
  });

  describe("validateExtensionContributionExecution", () => {
    it("blocks missing skill", () => {
      const context = createMinimalContext();
      const result = validateExtensionContributionExecution(
        "skills",
        "missing",
        "trigger",
        context,
      );
      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.summary).toContain("未发现");
    });

    it("blocks disabled skill", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "test.json"),
        JSON.stringify({ id: "test", triggers: ["foo"], permissions: [], source: "third-party" }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);
      const context = createMinimalContext();
      context.skills = state;

      const result = validateExtensionContributionExecution("skills", "test", "foo", context);
      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.summary).toContain("未启用或未信任");
    });

    it("blocks unregistered trigger", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "test.json"),
        JSON.stringify({ id: "test", triggers: ["foo"], permissions: [], source: "official" }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);
      const context = createMinimalContext();
      context.skills = state;

      const result = validateExtensionContributionExecution("skills", "test", "bar", context);
      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.summary).toContain("未注册触发项");
    });

    it("allows valid skill trigger", async () => {
      const skillsDir = join(projectPath, ".linghun", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "test.json"),
        JSON.stringify({ id: "test", triggers: ["foo"], permissions: [], source: "official" }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createSkillState(config, projectPath);
      const context = createMinimalContext();
      context.skills = state;

      const result = validateExtensionContributionExecution("skills", "test", "foo", context);
      expect(result.ok).toBe(true);
    });

    it("blocks unregistered plugin contribution", async () => {
      const pluginsDir = join(projectPath, ".linghun", "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(
        join(pluginsDir, "test.json"),
        JSON.stringify({
          id: "test",
          permissions: [],
          source: "official",
          contributions: { commands: ["foo"] },
        }),
        "utf8",
      );

      const config = createMinimalConfig();
      const state = await createPluginState(config, projectPath);
      const context = createMinimalContext();
      context.plugins = state;

      const result = validateExtensionContributionExecution("plugins", "test", "bar", context);
      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.summary).toContain("未注册贡献项");
    });
  });

  describe("parseExtensionInstallRequest", () => {
    it("parses local path", () => {
      const result = parseExtensionInstallRequest(["./path"]);
      expect(result).toEqual({
        source: "local",
        locator: "./path",
        scope: "project",
        ref: undefined,
        confirmNetwork: false,
      });
    });

    it("parses explicit local", () => {
      const result = parseExtensionInstallRequest(["local", "./path", "--scope", "user"]);
      expect(result).toEqual({
        source: "local",
        locator: "./path",
        scope: "user",
        ref: undefined,
        confirmNetwork: false,
      });
    });

    it("parses git url", () => {
      const result = parseExtensionInstallRequest([
        "git",
        "https://example.com/repo.git",
        "--ref",
        "v1.0.0",
        "--confirm-network",
      ]);
      expect(result).toEqual({
        source: "git",
        locator: "https://example.com/repo.git",
        scope: "project",
        ref: "v1.0.0",
        confirmNetwork: true,
      });
    });

    it("parses github shorthand", () => {
      const result = parseExtensionInstallRequest(["github:owner/repo"]);
      expect(result).toEqual({
        source: "github",
        locator: "owner/repo",
        scope: "project",
        ref: undefined,
        confirmNetwork: false,
      });
    });

    it("infers git from url", () => {
      const result = parseExtensionInstallRequest(["https://example.com/repo.git"]);
      expect(result).toEqual({
        source: "git",
        locator: "https://example.com/repo.git",
        scope: "project",
        ref: undefined,
        confirmNetwork: false,
      });
    });

    it("returns null for empty args", () => {
      expect(parseExtensionInstallRequest([])).toBeNull();
    });
  });

  describe("isGitLocator", () => {
    it("detects https url", () => {
      expect(isGitLocator("https://example.com/repo.git")).toBe(true);
    });

    it("detects http url", () => {
      expect(isGitLocator("http://example.com/repo.git")).toBe(true);
    });

    it("detects git@ ssh", () => {
      expect(isGitLocator("git@github.com:owner/repo.git")).toBe(true);
    });

    it("detects .git suffix", () => {
      expect(isGitLocator("something.git")).toBe(true);
    });

    it("rejects local path", () => {
      expect(isGitLocator("./local/path")).toBe(false);
    });
  });

  describe("githubRepoToUrl", () => {
    it("converts owner/repo to url", () => {
      expect(githubRepoToUrl("owner/repo")).toBe("https://github.com/owner/repo.git");
    });

    it("passes through full url", () => {
      expect(githubRepoToUrl("https://example.com/repo.git")).toBe("https://example.com/repo.git");
    });

    it("rejects invalid format", () => {
      expect(githubRepoToUrl("invalid")).toBeNull();
    });
  });
});

function createMinimalConfig(): LinghunConfig {
  return {
    language: "zh-CN",
    defaultModel: "gpt-4o",
    providers: {},
    permission: { defaultMode: "default" },
    storage: {
      projectData: { scope: "project" },
      userData: { scope: "user" },
      sessions: { scope: "user" },
      memory: {
        project: { scope: "project" },
        user: { scope: "user" },
        session: { scope: "user" },
      },
      index: { scope: "user" },
      logs: { scope: "user" },
      jobs: { scope: "user" },
      cache: { scope: "user" },
    },
    index: { enabled: true, mode: "fast", ignoreFile: ".linghunignore" },
    promptCache: { enabled: true, systemTtl: "5m" },
    modelRoutes: { defaultModel: "gpt-4o", routes: [] },
    workspaceTrust: { recorded: false, level: "restricted" },
    mcp: { enabledServers: [], servers: {} },
    skills: {
      enabled: true,
      projectDir: ".linghun/skills",
      userDir: "~/.linghun/skills",
      disabledIds: [],
      trustedIds: [],
    },
    plugins: {
      enabled: true,
      projectDir: ".linghun/plugins",
      userDir: "~/.linghun/plugins",
      disabledIds: [],
      trustedIds: [],
    },
    hooks: {
      enabled: false,
      projectTrusted: false,
      timeoutMs: 5000,
      outputLimitBytes: 10240,
      disabledIds: [],
      trustedIds: [],
    },
    workflows: { enabled: true, disabledIds: [] },
    remote: { enabled: false, channels: {} },
    nativeRunner: {
      enabled: false,
      expectedProtocol: "1.0.0",
      source: "disabled",
      timeoutMs: 30000,
    },
  };
}

function createMinimalContext(): TuiContext {
  return {
    language: "zh-CN",
    skills: {
      enabled: true,
      projectDir: ".linghun/skills",
      userDir: "~/.linghun/skills",
      skills: [],
      disabledIds: [],
      trustedIds: [],
      evolutionCandidates: [],
      rejectedEvolutionCandidates: [],
    },
    plugins: {
      enabled: true,
      projectDir: ".linghun/plugins",
      userDir: "~/.linghun/plugins",
      plugins: [],
      disabledIds: [],
      trustedIds: [],
    },
  } as unknown as TuiContext;
}
