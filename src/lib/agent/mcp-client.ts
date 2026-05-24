import "server-only";

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX =
  "mcp__plugin_krw-ontology_krw-ontology__";

export const KRW_ONTOLOGY_MCP_TOOLS = [
  "krw_ontology_catalog",
  "krw_ontology_company_context",
  "krw_ontology_index_context",
  "krw_ontology_topic_map",
  "krw_ontology_query",
  "krw_ontology_query_context",
  "krw_ontology_retrieve",
  "krw_ontology_trace",
  "krw_ontology_quality",
  "krw_ontology_compare",
  "krw_ontology_plan_query",
  "krw_ontology_chain",
] as const;

export const KRW_ONTOLOGY_SDK_ALLOWED_TOOLS = KRW_ONTOLOGY_MCP_TOOLS.map(
  (toolName) => `${KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX}${toolName}`,
);

const KRW_ONTOLOGY_MCP_TOOL_SET = new Set<string>(KRW_ONTOLOGY_MCP_TOOLS);
const execFileAsync = promisify(execFile);
const DEFAULT_MCP_HEALTH_TIMEOUT_MS = 30_000;

export function isKrwOntologySdkTool(toolName: string): boolean {
  if (!toolName.startsWith(KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX.length);

  return Boolean(bareName && KRW_ONTOLOGY_MCP_TOOL_SET.has(bareName));
}

export interface McpHealthResult {
  connected: boolean;
  staticOk: boolean;
  commandOk: boolean;
  liveOk: boolean;
  sqliteOk: boolean;
  releaseId: string | null;
  indexGeneratedAt: string | null;
  companyCount: number | null;
  documentCount: number | null;
  objectCount: number | null;
  toolCount: number | null;
  tools: string[];
  root: string | null;
  indexPath: string | null;
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

async function isExecutable(command: string): Promise<boolean> {
  if (!path.isAbsolute(command)) return true;

  try {
    await access(command, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function baseHealthResult(
  pluginPath: string,
  root: string | null = null,
): Omit<McpHealthResult, "connected"> {
  return {
    staticOk: false,
    commandOk: false,
    liveOk: false,
    sqliteOk: false,
    releaseId: null,
    indexGeneratedAt: null,
    companyCount: null,
    documentCount: null,
    objectCount: null,
    toolCount: null,
    tools: [],
    root,
    indexPath: null,
    pluginPath,
  };
}

function getHealthTimeoutMs(): number {
  const parsed = Number(process.env.MCP_HEALTH_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1_000
    ? parsed
    : DEFAULT_MCP_HEALTH_TIMEOUT_MS;
}

function buildHealthCommand(serverConfig: NonNullable<PluginMcpConfig["mcpServers"]>[string]): {
  command: string;
  args: string[];
} {
  const command = serverConfig.command ?? "";
  const args = serverConfig.args ?? [];

  if (path.basename(command) === "uv") {
    const directoryIndex = args.indexOf("--directory");
    const directory =
      directoryIndex >= 0 ? args[directoryIndex + 1] : process.cwd();
    return {
      command,
      args: [
        "--directory",
        directory,
        "run",
        "python",
        "-c",
        MCP_HEALTH_PYTHON_CODE,
      ],
    };
  }

  if (path.isAbsolute(command)) {
    return {
      command: path.join(path.dirname(command), "python"),
      args: ["-c", MCP_HEALTH_PYTHON_CODE],
    };
  }

  return {
    command: process.env.KRW_ONTOLOGY_HEALTH_PYTHON || "python3",
    args: ["-c", MCP_HEALTH_PYTHON_CODE],
  };
}

const MCP_HEALTH_PYTHON_CODE = `
import json
import os
from krw_ontology.mcp_server.server import health_payload

payload, status = health_payload(root=os.environ.get("KRW_ONTOLOGY_ROOT"))
print(json.dumps({"status": status, "payload": payload}, ensure_ascii=False))
raise SystemExit(0 if status == 200 and payload.get("ok") else 1)
`;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function runLiveMcpHealth(
  serverConfig: NonNullable<PluginMcpConfig["mcpServers"]>[string],
  root: string | null,
): Promise<
  Pick<
    McpHealthResult,
    | "liveOk"
    | "sqliteOk"
    | "releaseId"
    | "indexGeneratedAt"
    | "companyCount"
    | "documentCount"
    | "objectCount"
    | "toolCount"
    | "tools"
    | "root"
    | "indexPath"
  >
> {
  const healthCommand = buildHealthCommand(serverConfig);
  const env = {
    ...process.env,
    ...(serverConfig.env ?? {}),
    ...(root ? { KRW_ONTOLOGY_ROOT: root } : {}),
  };
  const { stdout } = await execFileAsync(healthCommand.command, healthCommand.args, {
    env,
    timeout: getHealthTimeoutMs(),
    maxBuffer: 1024 * 1024,
  });
  const parsed = JSON.parse(stdout.trim()) as {
    status?: number;
    payload?: Record<string, unknown>;
  };
  const payload = parsed.payload ?? {};
  const tools = asStringArray(payload.tools);

  return {
    liveOk: parsed.status === 200 && payload.ok === true,
    sqliteOk:
      parsed.status === 200 &&
      payload.ok === true &&
      typeof payload.index_path === "string" &&
      asNumber(payload.documents) !== null &&
      asNumber(payload.objects) !== null,
    releaseId: asString(payload.release_id),
    indexGeneratedAt: asString(payload.index_generated_at),
    companyCount: asNumber(payload.companies),
    documentCount: asNumber(payload.documents),
    objectCount: asNumber(payload.objects),
    toolCount: tools.length,
    tools,
    root: asString(payload.root) ?? root,
    indexPath: asString(payload.index_path),
  };
}

export async function checkMcpHealth(): Promise<McpHealthResult> {
  const pluginPath = getKrwOntologyPluginPath();
  const manifestPath = path.join(pluginPath, ".claude-plugin", "plugin.json");
  const mcpConfigPath = path.join(pluginPath, ".mcp.json");
  const requiredSkillPaths = [
    path.join(pluginPath, "skills", "krw-ontology-research", "SKILL.md"),
  ];

  try {
    const [hasManifest, hasMcpConfig, ...hasRequiredSkills] = await Promise.all([
      exists(manifestPath),
      exists(mcpConfigPath),
      ...requiredSkillPaths.map((skillPath) => exists(skillPath)),
    ]);

    if (!hasManifest || !hasMcpConfig || !hasRequiredSkills.every(Boolean)) {
      return {
        ...baseHealthResult(pluginPath),
        connected: false,
        error: "KRW Ontology KRW-AI plugin workflow files are incomplete",
      };
    }

    const mcpConfig = JSON.parse(
      await readFile(mcpConfigPath, "utf8"),
    ) as PluginMcpConfig;
    const serverConfig = mcpConfig.mcpServers?.["krw-ontology"];
    const root =
      process.env.KRW_ONTOLOGY_ROOT || serverConfig?.env?.KRW_ONTOLOGY_ROOT || null;

    if (!serverConfig?.command) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        connected: false,
        error: "KRW Ontology MCP server command is missing",
      };
    }

    if (!(await isExecutable(serverConfig.command))) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        connected: false,
        error: `KRW Ontology MCP server command is not executable: ${serverConfig.command}`,
      };
    }

    if (root) {
      const indexPath = path.join(root, "indexes", "agent_index.sqlite");
      if (!(await exists(indexPath))) {
        return {
          ...baseHealthResult(pluginPath, root),
          staticOk: true,
          commandOk: true,
          indexPath,
          connected: false,
          error: `Ontology agent index not found at ${indexPath}`,
        };
      }
    }

    const liveHealth = await runLiveMcpHealth(serverConfig, root);
    if (!liveHealth.liveOk || !liveHealth.sqliteOk) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        commandOk: true,
        ...liveHealth,
        connected: false,
        error: "KRW Ontology MCP live health check failed",
      };
    }

    return {
      connected: true,
      staticOk: true,
      commandOk: true,
      ...liveHealth,
      pluginPath,
    };
  } catch (err) {
    return {
      ...baseHealthResult(pluginPath),
      connected: false,
      error: err instanceof Error ? err.message : "Unknown plugin health error",
    };
  }
}
