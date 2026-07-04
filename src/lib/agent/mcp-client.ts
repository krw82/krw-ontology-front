import "server-only";

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeOntologyEnv, type OntologyEnv } from "@/lib/env";
import type {
  ChartMCPToolName,
  KRWOntologyMCPToolName,
  StockNewsMCPToolName,
} from "@/types/api-contracts";
import type { Json } from "@/types/database";
import {
  YAHOO_FINANCE_MCP_SERVER_NAME,
  YAHOO_FINANCE_MCP_TOOLS,
  YAHOO_FINANCE_SDK_ALLOWED_TOOLS,
} from "@/lib/news-discovery/yahoo-finance-mcp-constants";

const KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX =
  "mcp__plugin_krw-ontology_krw-ontology__";
const STOCK_NEWS_PLUGIN_TOOL_PREFIX =
  "mcp__plugin_krw-ontology_stock-news__";
const CHART_MCP_TOOL_PREFIX = "mcp__krw_presentation__";
const YAHOO_FINANCE_MCP_TOOL_PREFIX =
  `mcp__${YAHOO_FINANCE_MCP_SERVER_NAME}__`;

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
] as const satisfies readonly KRWOntologyMCPToolName[];

export const STOCK_NEWS_MCP_TOOLS = [
  "route_news_question",
  "resolve_news_entities",
  "search_company_news_events",
  "search_market_news_events",
  "search_news_by_domain",
  "read_news_sources",
  "build_news_timeline",
  "audit_news_sources",
] as const satisfies readonly StockNewsMCPToolName[];

export const CHART_MCP_TOOLS = [
  "create_chart_v1",
] as const satisfies readonly ChartMCPToolName[];

export {
  YAHOO_FINANCE_MCP_TOOLS,
  YAHOO_FINANCE_SDK_ALLOWED_TOOLS,
};

export const KRW_ONTOLOGY_SDK_ALLOWED_TOOLS = KRW_ONTOLOGY_MCP_TOOLS.map(
  (toolName) => `${KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX}${toolName}`,
);

export const STOCK_NEWS_SDK_ALLOWED_TOOLS = STOCK_NEWS_MCP_TOOLS.map(
  (toolName) => `${STOCK_NEWS_PLUGIN_TOOL_PREFIX}${toolName}`,
);

export const CHART_SDK_ALLOWED_TOOLS = CHART_MCP_TOOLS.map(
  (toolName) => `${CHART_MCP_TOOL_PREFIX}${toolName}`,
);

const KRW_ONTOLOGY_MCP_TOOL_SET = new Set<string>(KRW_ONTOLOGY_MCP_TOOLS);
const STOCK_NEWS_MCP_TOOL_SET = new Set<string>(STOCK_NEWS_MCP_TOOLS);
const YAHOO_FINANCE_MCP_TOOL_SET = new Set<string>(YAHOO_FINANCE_MCP_TOOLS);
const CHART_MCP_TOOL_SET = new Set<string>(CHART_MCP_TOOLS);
const execFileAsync = promisify(execFile);
const DEFAULT_MCP_HEALTH_TIMEOUT_MS = 30_000;
type McpProbeKind = "health" | "ready";

export function isKrwOntologySdkTool(toolName: string): boolean {
  if (!toolName.startsWith(KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(KRW_ONTOLOGY_PLUGIN_TOOL_PREFIX.length);

  return Boolean(bareName && KRW_ONTOLOGY_MCP_TOOL_SET.has(bareName));
}

export function isStockNewsSdkTool(toolName: string): boolean {
  if (!toolName.startsWith(STOCK_NEWS_PLUGIN_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(STOCK_NEWS_PLUGIN_TOOL_PREFIX.length);

  return Boolean(bareName && STOCK_NEWS_MCP_TOOL_SET.has(bareName));
}

export function isYahooFinanceSdkTool(toolName: string): boolean {
  if (!toolName.startsWith(YAHOO_FINANCE_MCP_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(YAHOO_FINANCE_MCP_TOOL_PREFIX.length);

  return Boolean(bareName && YAHOO_FINANCE_MCP_TOOL_SET.has(bareName));
}

export function isChartSdkTool(toolName: string): boolean {
  if (!toolName.startsWith(CHART_MCP_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(CHART_MCP_TOOL_PREFIX.length);

  return Boolean(bareName && CHART_MCP_TOOL_SET.has(bareName));
}

export function isStockNewsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (truthyEnv(env.STOCK_NEWS_FORCE_DISABLED)) return false;
  if (!truthyEnv(env.STOCK_NEWS_ENABLED)) return false;
  if (!env.FINNHUB_API_KEY) return false;

  return true;
}

export function getStockNewsSdkAllowedTools(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return isStockNewsEnabled(env) ? STOCK_NEWS_SDK_ALLOWED_TOOLS : [];
}

function truthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export interface McpHealthResult {
  connected: boolean;
  staticOk: boolean;
  commandOk: boolean;
  liveOk: boolean;
  sqliteOk: boolean;
  env: OntologyEnv | null;
  releaseId: string | null;
  manifestPath: string | null;
  manifestValid: boolean;
  agentIndexSchemaVersion: string | null;
  indexGeneratedAt: string | null;
  companyCount: number | null;
  documentCount: number | null;
  objectCount: number | null;
  toolCount: number | null;
  tools: string[];
  root: string | null;
  indexPath: string | null;
  pluginPath: string;
  releaseMetadata: Json | null;
  error?: string;
}

interface PluginMcpConfig {
  mcpServers?: Record<
    string,
    {
      type?: "stdio" | "http" | "sse";
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
      alwaysLoad?: boolean;
    }
  >;
}

type PluginMcpServerConfig = NonNullable<PluginMcpConfig["mcpServers"]>[string];

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
    env: null,
    releaseId: null,
    manifestPath: null,
    manifestValid: false,
    agentIndexSchemaVersion: null,
    indexGeneratedAt: null,
    companyCount: null,
    documentCount: null,
    objectCount: null,
    toolCount: null,
    tools: [],
    root,
    indexPath: null,
    pluginPath,
    releaseMetadata: null,
  };
}

function getHealthTimeoutMs(): number {
  const parsed = Number(process.env.MCP_HEALTH_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1_000
    ? parsed
    : DEFAULT_MCP_HEALTH_TIMEOUT_MS;
}

function buildHealthCommand(
  serverConfig: PluginMcpServerConfig,
  probeKind: McpProbeKind,
): {
  command: string;
  args: string[];
} {
  const command = serverConfig.command ?? "";
  const args = serverConfig.args ?? [];
  const probePythonCode =
    probeKind === "ready" ? MCP_READY_PYTHON_CODE : MCP_HEALTH_PYTHON_CODE;

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
        probePythonCode,
      ],
    };
  }

  if (path.isAbsolute(command)) {
    return {
      command: path.join(path.dirname(command), "python"),
      args: ["-c", probePythonCode],
    };
  }

  return {
    command: process.env.KRW_ONTOLOGY_HEALTH_PYTHON || "python3",
    args: ["-c", probePythonCode],
  };
}

const MCP_HEALTH_PYTHON_CODE = `
import json
import os
from krw_ontology.mcp_server.server import health_payload

payload, status = health_payload()
print(json.dumps({"status": status, "payload": payload}, ensure_ascii=False))
raise SystemExit(0 if status == 200 and payload.get("ok") else 1)
`;

const MCP_READY_PYTHON_CODE = `
import json
import os
from krw_ontology.mcp_server.server import ready_payload

payload, status = ready_payload()
print(json.dumps({"status": status, "payload": payload}, ensure_ascii=False))
raise SystemExit(0 if status == 200 and payload.get("ok") else 1)
`;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isHttpMcpServer(serverConfig: PluginMcpServerConfig): boolean {
  return serverConfig.type === "http" || serverConfig.type === "sse";
}

function getConfiguredMcpUrl(serverConfig: PluginMcpServerConfig): string | null {
  return process.env.KRW_ONTOLOGY_MCP_URL || serverConfig.url || null;
}

function healthUrlFromMcpUrl(mcpUrl: string): string {
  const parsed = new URL(mcpUrl);
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function readyUrlFromMcpUrl(mcpUrl: string): string {
  const parsed = new URL(mcpUrl);
  parsed.pathname = "/readyz";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function parseMcpHealthPayload(
  status: number,
  payload: Record<string, unknown>,
  root: string | null,
): Promise<
  Pick<
    McpHealthResult,
    | "liveOk"
    | "sqliteOk"
    | "env"
    | "releaseId"
    | "manifestPath"
    | "manifestValid"
    | "agentIndexSchemaVersion"
    | "indexGeneratedAt"
    | "companyCount"
    | "documentCount"
    | "objectCount"
    | "toolCount"
    | "tools"
    | "root"
    | "indexPath"
    | "releaseMetadata"
  >
> {
  const tools = asStringArray(payload.tools);
  const ontologyEnv = normalizeOntologyEnv(asString(payload.env) ?? undefined);
  const manifestValid = asBoolean(payload.manifest_valid) ?? false;
  const indexGeneratedAt =
    asString(payload.index_generated_at) ?? asString(payload.generated_at);
  const companyCount =
    asNumber(payload.companies) ?? asNumber(payload.company_count);
  const documentCount =
    asNumber(payload.documents) ?? asNumber(payload.document_count);
  const objectCount = asNumber(payload.objects) ?? asNumber(payload.object_count);
  const globalSpinePath = asString(payload.global_spine_path);
  const releaseMetadata = {
    env: ontologyEnv,
    release_id: asString(payload.release_id),
    manifest_path: asString(payload.manifest_path),
    manifest_valid: manifestValid,
    agent_index_schema_version: asString(payload.agent_index_schema_version),
    index_generated_at: indexGeneratedAt,
    root: asString(payload.root) ?? root,
    index_path: globalSpinePath,
    global_spine_path: globalSpinePath,
    company_count: companyCount,
    document_count: documentCount,
    object_count: objectCount,
  };

  return Promise.resolve({
    liveOk: status === 200 && payload.ok === true,
    sqliteOk:
      status === 200 &&
      payload.ok === true &&
      typeof payload.global_spine_path === "string" &&
      documentCount !== null &&
      objectCount !== null,
    env: ontologyEnv,
    releaseId: asString(payload.release_id),
    manifestPath: asString(payload.manifest_path),
    manifestValid,
    agentIndexSchemaVersion: asString(payload.agent_index_schema_version),
    indexGeneratedAt,
    companyCount,
    documentCount,
    objectCount,
    toolCount: tools.length,
    tools,
    root: asString(payload.root) ?? root,
    indexPath: globalSpinePath,
    releaseMetadata: (asRecord(payload.manifest) as Json | null) ?? releaseMetadata,
  });
}

async function runHttpMcpHealth(
  serverConfig: PluginMcpServerConfig,
  root: string | null,
  probeKind: McpProbeKind,
): Promise<
  Awaited<ReturnType<typeof parseMcpHealthPayload>>
> {
  const mcpUrl = getConfiguredMcpUrl(serverConfig);
  if (!mcpUrl) {
    throw new Error("KRW Ontology MCP HTTP URL is missing");
  }
  const healthUrl =
    probeKind === "ready"
      ? process.env.KRW_ONTOLOGY_MCP_READY_URL || readyUrlFromMcpUrl(mcpUrl)
      : process.env.KRW_ONTOLOGY_MCP_HEALTH_URL || healthUrlFromMcpUrl(mcpUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getHealthTimeoutMs());
  try {
    const response = await fetch(healthUrl, {
      headers: { accept: "application/json", ...(serverConfig.headers ?? {}) },
      signal: controller.signal,
    });
    const payload = (await response.json()) as Record<string, unknown>;
    return parseMcpHealthPayload(response.status, payload, root);
  } finally {
    clearTimeout(timeout);
  }
}

async function runStdioMcpHealth(
  serverConfig: PluginMcpServerConfig,
  root: string | null,
  probeKind: McpProbeKind,
): Promise<
  Awaited<ReturnType<typeof parseMcpHealthPayload>>
> {
  const healthCommand = buildHealthCommand(serverConfig, probeKind);
  const env = {
    ...(serverConfig.env ?? {}),
    ...process.env,
    ...(root
      ? {
          KRW_ONTOLOGY_RELEASE_ROOT: root,
          KRW_ONTOLOGY_ROOT: root,
          KRW_ONTOLOGY_MANIFEST_PATH:
            process.env.KRW_ONTOLOGY_MANIFEST_PATH ||
            path.join(root, "manifest.json"),
          KRW_ONTOLOGY_GLOBAL_SPINE_PATH:
            process.env.KRW_ONTOLOGY_GLOBAL_SPINE_PATH ||
            path.join(root, "indexes", "global_spine.sqlite"),
          KRW_ONTOLOGY_SHARD_MANIFEST_PATH:
            process.env.KRW_ONTOLOGY_SHARD_MANIFEST_PATH ||
            path.join(root, "indexes", "shard_manifest.json"),
        }
      : {}),
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
  return parseMcpHealthPayload(parsed.status ?? 500, parsed.payload ?? {}, root);
}

async function checkMcpProbe(probeKind: McpProbeKind): Promise<McpHealthResult> {
  const pluginPath = getKrwOntologyPluginPath();
  const manifestPath = path.join(pluginPath, ".claude-plugin", "plugin.json");
  const mcpConfigPath = path.join(pluginPath, ".mcp.json");
  const requiredSkillPaths = [
    path.join(pluginPath, "skills", "krw-ontology-research", "SKILL.md"),
    path.join(pluginPath, "skills", "krw-ontology-idea-generation", "SKILL.md"),
    path.join(pluginPath, "skills", "krw-ontology-news-discovery", "SKILL.md"),
    path.join(pluginPath, "skills", "krw-ontology-market-move-research", "SKILL.md"),
    path.join(pluginPath, "skills", "krw-ontology-router", "SKILL.md"),
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
      process.env.KRW_ONTOLOGY_RELEASE_ROOT ||
      process.env.KRW_ONTOLOGY_ROOT ||
      serverConfig?.env?.KRW_ONTOLOGY_RELEASE_ROOT ||
      serverConfig?.env?.KRW_ONTOLOGY_ROOT ||
      null;

    if (!serverConfig) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        connected: false,
        error: "KRW Ontology MCP server config is missing",
      };
    }

    const isHttp = isHttpMcpServer(serverConfig);
    const commandOk = isHttp ? Boolean(getConfiguredMcpUrl(serverConfig)) : Boolean(serverConfig.command);

    if (!commandOk) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        connected: false,
        error: isHttp
          ? "KRW Ontology MCP HTTP URL is missing"
          : "KRW Ontology MCP server command is missing",
      };
    }

    if (!isHttp && serverConfig.command && !(await isExecutable(serverConfig.command))) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        connected: false,
        error: `KRW Ontology MCP server command is not executable: ${serverConfig.command}`,
      };
    }

    if (
      root ||
      process.env.KRW_ONTOLOGY_GLOBAL_SPINE_PATH ||
      serverConfig.env?.KRW_ONTOLOGY_GLOBAL_SPINE_PATH
    ) {
      const indexPath =
        process.env.KRW_ONTOLOGY_GLOBAL_SPINE_PATH ||
        serverConfig.env?.KRW_ONTOLOGY_GLOBAL_SPINE_PATH ||
        path.join(root ?? "", "indexes", "global_spine.sqlite");
      if (!(await exists(indexPath))) {
        return {
          ...baseHealthResult(pluginPath, root),
          staticOk: true,
          commandOk: true,
          indexPath,
          connected: false,
          error: `Ontology global spine not found at ${indexPath}`,
        };
      }
    }

    const liveHealth = isHttp
      ? await runHttpMcpHealth(serverConfig, root, probeKind)
      : await runStdioMcpHealth(serverConfig, root, probeKind);
    if (!liveHealth.liveOk || !liveHealth.sqliteOk) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        commandOk,
        ...liveHealth,
        connected: false,
        error:
          probeKind === "ready"
            ? "KRW Ontology MCP readiness check failed"
            : "KRW Ontology MCP live health check failed",
      };
    }

    return {
      connected: true,
      staticOk: true,
      commandOk,
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

export async function checkMcpHealth(): Promise<McpHealthResult> {
  return checkMcpProbe("health");
}

export async function checkMcpReady(): Promise<McpHealthResult> {
  return checkMcpProbe("ready");
}
