import "server-only";

import { access, readFile } from "node:fs/promises";
import path from "node:path";

const KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX =
  "mcp__plugin_krw-ontology_krw-ontology__";
const KRW_ONTOLOGY_DIRECT_TOOL_PREFIX = "mcp__krw-ontology__";

export const KRW_ONTOLOGY_MCP_TOOLS = [
  "krw_ontology_catalog",
  "krw_ontology_topic_map",
  "krw_ontology_query",
  "krw_ontology_retrieve",
  "krw_ontology_trace",
  "krw_ontology_quality",
  "krw_ontology_compare",
  "krw_ontology_plan_query",
  "krw_ontology_chain",
] as const;

export const KRW_ONTOLOGY_SDK_ALLOWED_TOOLS = KRW_ONTOLOGY_MCP_TOOLS.flatMap(
  (toolName) => [
    `${KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX}${toolName}`,
    `${KRW_ONTOLOGY_DIRECT_TOOL_PREFIX}${toolName}`,
  ],
);

const KRW_ONTOLOGY_MCP_TOOL_SET = new Set<string>(KRW_ONTOLOGY_MCP_TOOLS);

export function isKrwOntologySdkTool(toolName: string): boolean {
  const bareName = toolName.includes("__")
    ? toolName.split("__").at(-1)
    : toolName;

  return Boolean(bareName && KRW_ONTOLOGY_MCP_TOOL_SET.has(bareName));
}

export interface McpHealthResult {
  connected: boolean;
  releaseId: string | null;
  indexGeneratedAt: string | null;
  companyCount: number | null;
  documentCount: number | null;
  objectCount: number | null;
  root: string | null;
  pluginPath: string;
  error?: string;
}

interface PluginMcpConfig {
  mcpServers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
}

export function getKrwOntologyPluginPath(): string {
  const pluginPath =
    process.env.KRW_ONTOLOGY_PLUGIN_PATH || process.env.CLAUDE_PLUGIN_PATH;
  if (!pluginPath) {
    throw new Error(
      "Missing required environment variable: KRW_ONTOLOGY_PLUGIN_PATH",
    );
  }
  return pluginPath;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function checkMcpHealth(): Promise<McpHealthResult> {
  const pluginPath = getKrwOntologyPluginPath();
  const manifestPath = path.join(pluginPath, ".claude-plugin", "plugin.json");
  const mcpConfigPath = path.join(pluginPath, ".mcp.json");
  const requiredSkillPaths = [
    path.join(pluginPath, "skills", "krw-ontology-research", "SKILL.md"),
    path.join(pluginPath, "skills", "krw-ontology-answer-composer", "SKILL.md"),
  ];

  try {
    const [hasManifest, hasMcpConfig, ...hasRequiredSkills] = await Promise.all([
      exists(manifestPath),
      exists(mcpConfigPath),
      ...requiredSkillPaths.map((skillPath) => exists(skillPath)),
    ]);

    if (!hasManifest || !hasMcpConfig || !hasRequiredSkills.every(Boolean)) {
      return {
        connected: false,
        releaseId: null,
        indexGeneratedAt: null,
        companyCount: null,
        documentCount: null,
        objectCount: null,
        root: null,
        pluginPath,
        error: "KRW Ontology Claude plugin workflow files are incomplete",
      };
    }

    const mcpConfig = JSON.parse(
      await readFile(mcpConfigPath, "utf8"),
    ) as PluginMcpConfig;
    const serverConfig = mcpConfig.mcpServers?.["krw-ontology"];
    const root = serverConfig?.env?.KRW_ONTOLOGY_ROOT ?? null;

    if (!serverConfig?.command) {
      return {
        connected: false,
        releaseId: null,
        indexGeneratedAt: null,
        companyCount: null,
        documentCount: null,
        objectCount: null,
        root,
        pluginPath,
        error: "KRW Ontology MCP server command is missing",
      };
    }

    if (root) {
      const indexPath = path.join(root, "indexes", "agent_index.sqlite");
      if (!(await exists(indexPath))) {
        return {
          connected: false,
          releaseId: null,
          indexGeneratedAt: null,
          companyCount: null,
          documentCount: null,
          objectCount: null,
          root,
          pluginPath,
          error: `Ontology agent index not found at ${indexPath}`,
        };
      }
    }

    return {
      connected: true,
      releaseId: null,
      indexGeneratedAt: null,
      companyCount: null,
      documentCount: null,
      objectCount: null,
      root,
      pluginPath,
    };
  } catch (err) {
    return {
      connected: false,
      releaseId: null,
      indexGeneratedAt: null,
      companyCount: null,
      documentCount: null,
      objectCount: null,
      root: null,
      pluginPath,
      error: err instanceof Error ? err.message : "Unknown plugin health error",
    };
  }
}
