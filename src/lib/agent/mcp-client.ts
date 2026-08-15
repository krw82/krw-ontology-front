import "server-only";

import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getOntologyEnv,
  normalizeOntologyEnv,
  type OntologyEnv,
} from "@/lib/env";
import type {
  GuruMCPToolName,
  KrwFeedMCPToolName,
  KrwFilingsMCPToolName,
  KRWOntologyMCPToolName,
  StockNewsMCPToolName,
} from "@/types/api-contracts";
import type { Json } from "@/types/database";
import {
  YAHOO_FINANCE_MCP_SERVER_NAME,
  YAHOO_FINANCE_MCP_TOOLS,
  YAHOO_FINANCE_SDK_ALLOWED_TOOLS,
} from "@/lib/news-discovery/yahoo-finance-mcp-constants";
import { verifyMaterializedOntologyPluginContract } from "@/lib/agent/plugin-contract";

const KRW_ONTOLOGY_MCP_SERVER_NAME = "krw-ontology";
const KRW_ONTOLOGY_DIRECT_TOOL_PREFIX =
  `mcp__${KRW_ONTOLOGY_MCP_SERVER_NAME}__`;
const STOCK_NEWS_MCP_SERVER_NAME = "stock-news";
const STOCK_NEWS_DIRECT_TOOL_PREFIX = `mcp__${STOCK_NEWS_MCP_SERVER_NAME}__`;
const GURU_ADVISOR_PLUGIN_TOOL_PREFIX =
  "mcp__plugin_krw-guru-advisor_krw-guru-advisor__";
const YAHOO_FINANCE_MCP_TOOL_PREFIX =
  `mcp__${YAHOO_FINANCE_MCP_SERVER_NAME}__`;
export const KRW_FILINGS_MCP_SERVER_NAME = "krw-filings";
const KRW_FILINGS_DIRECT_TOOL_PREFIX =
  `mcp__${KRW_FILINGS_MCP_SERVER_NAME}__`;
export const KRW_FEED_MCP_SERVER_NAME = "krw-feed";
const KRW_FEED_DIRECT_TOOL_PREFIX = `mcp__${KRW_FEED_MCP_SERVER_NAME}__`;

export const KRW_ONTOLOGY_MCP_TOOLS = [
  "krw_ontology_catalog",
  "krw_ontology_company_context",
  "krw_ontology_index_context",
  "krw_ontology_topic_map",
  "krw_ontology_query",
  "krw_ontology_query_context",
  "krw_ontology_retrieve",
  "krw_ontology_trace",
  "krw_ontology_verify_evidence",
  "krw_ontology_quality",
  "krw_ontology_compare",
  "krw_ontology_plan_query",
  "krw_ontology_chain",
] as const satisfies readonly KRWOntologyMCPToolName[];

export const KRW_ONTOLOGY_MCP_CONTRACT_VERSION = "krw-ontology-mcp/v2";

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

export const KRW_FEED_MCP_TOOLS = [
  "get_feed_items",
  "list_feed_items",
  "get_feed_context",
] as const satisfies readonly KrwFeedMCPToolName[];

export const KRW_FILINGS_MCP_TOOLS = [
  "get_filing",
  "get_filing_brief",
  "search_catalog_filings",
  "list_filing_sections",
  "read_filing_section",
  "list_filing_documents",
  "read_filing_document",
  "get_form4_insider_transactions",
] as const satisfies readonly KrwFilingsMCPToolName[];

export const KRW_PERSONAL_FILINGS_MCP_TOOLS = [
  "get_coverage_state",
  "list_filing_judgments",
  "get_decision_timeline",
  "list_open_questions",
] as const satisfies readonly KrwFilingsMCPToolName[];

export const GURU_MCP_TOOLS = [
  "krw_guru_status",
  "krw_guru_search",
  "krw_guru_query_context",
  "krw_guru_select_lenses",
  "krw_guru_context",
  "krw_guru_trace",
  "krw_guru_chain",
  "krw_guru_evidence",
  "krw_guru_data_needs",
  "krw_guru_eval_questions",
  "krw_guru_company_brief",
  "krw_guru_company_pack",
  "krw_guru_review_company_evidence",
] as const satisfies readonly GuruMCPToolName[];

export {
  YAHOO_FINANCE_MCP_TOOLS,
  YAHOO_FINANCE_SDK_ALLOWED_TOOLS,
};

export const KRW_ONTOLOGY_SDK_ALLOWED_TOOLS = KRW_ONTOLOGY_MCP_TOOLS.map(
  (toolName) => `${KRW_ONTOLOGY_DIRECT_TOOL_PREFIX}${toolName}`,
);

export const KRW_ONTOLOGY_DIRECT_SDK_ALLOWED_TOOLS =
  KRW_ONTOLOGY_MCP_TOOLS.map(
    (toolName) => `${KRW_ONTOLOGY_DIRECT_TOOL_PREFIX}${toolName}`,
  );

export const STOCK_NEWS_SDK_ALLOWED_TOOLS = STOCK_NEWS_MCP_TOOLS.map(
  (toolName) => `${STOCK_NEWS_DIRECT_TOOL_PREFIX}${toolName}`,
);

export const KRW_FEED_SDK_ALLOWED_TOOLS = KRW_FEED_MCP_TOOLS.map(
  (toolName) => `${KRW_FEED_DIRECT_TOOL_PREFIX}${toolName}`,
);

export const GURU_ADVISOR_SDK_ALLOWED_TOOLS = GURU_MCP_TOOLS.map(
  (toolName) => `${GURU_ADVISOR_PLUGIN_TOOL_PREFIX}${toolName}`,
);

export const KRW_FILINGS_SDK_ALLOWED_TOOLS = KRW_FILINGS_MCP_TOOLS.map(
  (toolName) => `${KRW_FILINGS_DIRECT_TOOL_PREFIX}${toolName}`,
);

export const KRW_PERSONAL_FILINGS_SDK_ALLOWED_TOOLS =
  KRW_PERSONAL_FILINGS_MCP_TOOLS.map(
    (toolName) => `${KRW_FILINGS_DIRECT_TOOL_PREFIX}${toolName}`,
  );

const KRW_ONTOLOGY_MCP_TOOL_SET = new Set<string>(KRW_ONTOLOGY_MCP_TOOLS);
const STOCK_NEWS_MCP_TOOL_SET = new Set<string>(STOCK_NEWS_MCP_TOOLS);
const KRW_FEED_MCP_TOOL_SET = new Set<string>(KRW_FEED_MCP_TOOLS);
const GURU_MCP_TOOL_SET = new Set<string>(GURU_MCP_TOOLS);
const YAHOO_FINANCE_MCP_TOOL_SET = new Set<string>(YAHOO_FINANCE_MCP_TOOLS);
const KRW_FILINGS_MCP_TOOL_SET = new Set<string>(KRW_FILINGS_MCP_TOOLS);
const KRW_PERSONAL_FILINGS_MCP_TOOL_SET = new Set<string>(
  KRW_PERSONAL_FILINGS_MCP_TOOLS,
);
const DEFAULT_MCP_HEALTH_TIMEOUT_MS = 30_000;
type McpProbeKind = "health" | "ready";

export function isKrwOntologySdkTool(toolName: string): boolean {
  if (!toolName.startsWith(KRW_ONTOLOGY_DIRECT_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(KRW_ONTOLOGY_DIRECT_TOOL_PREFIX.length);

  return Boolean(bareName && KRW_ONTOLOGY_MCP_TOOL_SET.has(bareName));
}

export function isStockNewsSdkTool(toolName: string): boolean {
  if (!toolName.startsWith(STOCK_NEWS_DIRECT_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(STOCK_NEWS_DIRECT_TOOL_PREFIX.length);

  return Boolean(bareName && STOCK_NEWS_MCP_TOOL_SET.has(bareName));
}

export function isKrwFeedSdkTool(toolName: string): boolean {
  if (!toolName.startsWith(KRW_FEED_DIRECT_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(KRW_FEED_DIRECT_TOOL_PREFIX.length);
  return Boolean(bareName && KRW_FEED_MCP_TOOL_SET.has(bareName));
}

export function isGuruAdvisorSdkTool(toolName: string): boolean {
  if (!toolName.startsWith(GURU_ADVISOR_PLUGIN_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(GURU_ADVISOR_PLUGIN_TOOL_PREFIX.length);

  return Boolean(bareName && GURU_MCP_TOOL_SET.has(bareName));
}

export function isYahooFinanceSdkTool(toolName: string): boolean {
  if (!toolName.startsWith(YAHOO_FINANCE_MCP_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(YAHOO_FINANCE_MCP_TOOL_PREFIX.length);

  return Boolean(bareName && YAHOO_FINANCE_MCP_TOOL_SET.has(bareName));
}

export function isKrwFilingsSdkTool(toolName: string): boolean {
  if (!toolName.startsWith(KRW_FILINGS_DIRECT_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(KRW_FILINGS_DIRECT_TOOL_PREFIX.length);
  return Boolean(bareName && KRW_FILINGS_MCP_TOOL_SET.has(bareName));
}

export function isKrwPersonalFilingsSdkTool(toolName: string): boolean {
  if (!toolName.startsWith(KRW_FILINGS_DIRECT_TOOL_PREFIX)) return false;
  const bareName = toolName.slice(KRW_FILINGS_DIRECT_TOOL_PREFIX.length);
  return Boolean(bareName && KRW_PERSONAL_FILINGS_MCP_TOOL_SET.has(bareName));
}

export function isKrwFilingsMcpEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return truthyEnv(env.FILINGS_MCP_ENABLED) && Boolean(filingsMcpToken(env));
}

export function isKrwPersonalFilingsMcpEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isKrwFilingsMcpEnabled(env)
    && Boolean(personalFilingsMcpSigningSecret(env));
}

export function personalFilingsMcpSigningSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.FILINGS_MCP_PERSONAL_SIGNING_SECRET?.trim() || null;
}

export function filingsMcpToken(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.KRW_FILINGS_MCP_TOKEN?.trim() || env.FILINGS_MCP_AUTH_TOKEN?.trim() || null;
}

export function isStockNewsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!truthyEnv(env.STOCK_NEWS_RELEASE_ENABLED)) return false;
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

export function krwFeedMcpToken(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.KRW_FEED_MCP_TOKEN?.trim() || env.FEED_MCP_AUTH_TOKEN?.trim() || null;
}

export function isKrwFeedMcpEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return truthyEnv(env.KRW_FEED_MCP_ENABLED) && Boolean(krwFeedMcpToken(env));
}

export function getKrwFeedSdkAllowedTools(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return isKrwFeedMcpEnabled(env) ? KRW_FEED_SDK_ALLOWED_TOOLS : [];
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
  contractOk: boolean;
  toolParityOk: boolean;
  fingerprintOk: boolean;
  fingerprintErrors: string[];
  pluginContractOk?: boolean;
  pluginContractErrors?: string[];
  pluginContentSha256?: string | null;
  pluginMcpConfigSha256?: string | null;
  mcpContractVersion: string | null;
  buildId: string | null;
  backendGitSha: string | null;
  toolSchemaSha256: string | null;
  buildFingerprintSha256: string | null;
  releaseManifestSha256: string | null;
  serviceFingerprintSha256: string | null;
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

export type FilingsMcpHealthResult = {
  connected: boolean;
  tools: string[];
  error?: string;
};

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

export async function resolveGuruAdvisorPluginPath(): Promise<string> {
  const configured = process.env.KRW_GURU_ADVISOR_PLUGIN_PATH;
  if (configured) return configured;

  const ontologyPluginPath = process.env.KRW_ONTOLOGY_PLUGIN_PATH;
  if (ontologyPluginPath) {
    const siblingPluginPath = path.join(
      path.dirname(path.resolve(ontologyPluginPath)),
      "krw-guru-advisor",
    );
    if (await exists(siblingPluginPath)) return siblingPluginPath;
  }

  const ontologySourceRoot =
    process.env.KRW_ONTOLOGY_SOURCE_DIR || path.join(os.homedir(), "krw-ontology");
  const fallbackPluginPath = path.join(
    ontologySourceRoot,
    "plugins",
    "krw-guru-advisor",
  );
  if (await exists(fallbackPluginPath)) return fallbackPluginPath;

  throw new Error(
    "Missing KRW_GURU_ADVISOR_PLUGIN_PATH and default krw-guru-advisor plugin path was not found",
  );
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
    contractOk: false,
    toolParityOk: false,
    fingerprintOk: false,
    fingerprintErrors: [],
    pluginContractOk: false,
    pluginContractErrors: [],
    pluginContentSha256: null,
    pluginMcpConfigSha256: null,
    mcpContractVersion: null,
    buildId: null,
    backendGitSha: null,
    toolSchemaSha256: null,
    buildFingerprintSha256: null,
    releaseManifestSha256: null,
    serviceFingerprintSha256: null,
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

function isSha256(value: string | null): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/.test(value));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    left.every((value) => rightSet.has(value))
  );
}

function validateRuntimeFingerprint(payload: Record<string, unknown>): {
  contractOk: boolean;
  toolParityOk: boolean;
  fingerprintOk: boolean;
  fingerprintErrors: string[];
  mcpContractVersion: string | null;
  buildId: string | null;
  backendGitSha: string | null;
  toolSchemaSha256: string | null;
  buildFingerprintSha256: string | null;
  releaseManifestSha256: string | null;
  serviceFingerprintSha256: string | null;
  toolCount: number | null;
  tools: string[];
} {
  const mcpContractVersion = asString(payload.mcp_contract_version);
  const buildId = asString(payload.build_id);
  const backendGitSha = asString(payload.backend_git_sha);
  const toolSchemaSha256 = asString(payload.tool_schema_sha256);
  const buildFingerprintSha256 = asString(payload.build_fingerprint_sha256);
  const releaseManifestSha256 = asString(payload.release_manifest_sha256);
  const serviceFingerprintSha256 = asString(payload.service_fingerprint_sha256);
  const toolCount = asNumber(payload.tool_count);
  const tools = asStringArray(payload.tool_names);
  const contractOk =
    mcpContractVersion === KRW_ONTOLOGY_MCP_CONTRACT_VERSION;
  const toolParityOk =
    payload.tool_names_match === true &&
    toolCount === KRW_ONTOLOGY_MCP_TOOLS.length &&
    sameStringSet(tools, KRW_ONTOLOGY_MCP_TOOLS);
  const fingerprintErrors: string[] = [];

  if (!contractOk) {
    fingerprintErrors.push(
      `mcp_contract_version mismatch: ${mcpContractVersion ?? "missing"}`,
    );
  }
  if (!toolParityOk) {
    fingerprintErrors.push(
      `tool parity mismatch: expected ${KRW_ONTOLOGY_MCP_TOOLS.length} exact tools`,
    );
  }
  if (!buildId?.trim()) fingerprintErrors.push("build_id is missing");
  if (!backendGitSha?.trim() && !isSha256(buildFingerprintSha256)) {
    fingerprintErrors.push(
      "backend_git_sha is missing and build_fingerprint_sha256 is unavailable",
    );
  }

  for (const [field, value] of [
    ["tool_schema_sha256", toolSchemaSha256],
    ["build_fingerprint_sha256", buildFingerprintSha256],
    ["release_manifest_sha256", releaseManifestSha256],
    ["service_fingerprint_sha256", serviceFingerprintSha256],
  ] as const) {
    if (!isSha256(value)) {
      fingerprintErrors.push(`${field} is missing or is not a SHA-256 digest`);
    }
  }

  for (const [envName, field, value] of [
    [
      "KRW_MCP_EXPECTED_CONTRACT_VERSION",
      "mcp_contract_version",
      mcpContractVersion,
    ],
    ["KRW_MCP_EXPECTED_BUILD_ID", "build_id", buildId],
    ["KRW_MCP_EXPECTED_BACKEND_GIT_SHA", "backend_git_sha", backendGitSha],
    [
      "KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256",
      "tool_schema_sha256",
      toolSchemaSha256,
    ],
    [
      "KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256",
      "build_fingerprint_sha256",
      buildFingerprintSha256,
    ],
    [
      "KRW_MCP_EXPECTED_RELEASE_MANIFEST_SHA256",
      "release_manifest_sha256",
      releaseManifestSha256,
    ],
    [
      "KRW_MCP_EXPECTED_SERVICE_FINGERPRINT_SHA256",
      "service_fingerprint_sha256",
      serviceFingerprintSha256,
    ],
  ] as const) {
    const expected = process.env[envName]?.trim();
    if (expected && expected !== value) {
      fingerprintErrors.push(`${field} does not match ${envName}`);
    }
  }

  return {
    contractOk,
    toolParityOk,
    fingerprintOk: fingerprintErrors.length === 0,
    fingerprintErrors,
    mcpContractVersion,
    buildId,
    backendGitSha,
    toolSchemaSha256,
    buildFingerprintSha256,
    releaseManifestSha256,
    serviceFingerprintSha256,
    toolCount,
    tools,
  };
}

function isHttpMcpServer(serverConfig: PluginMcpServerConfig): boolean {
  return serverConfig.type === "http";
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
    | "contractOk"
    | "toolParityOk"
    | "fingerprintOk"
    | "fingerprintErrors"
    | "mcpContractVersion"
    | "buildId"
    | "backendGitSha"
    | "toolSchemaSha256"
    | "buildFingerprintSha256"
    | "releaseManifestSha256"
    | "serviceFingerprintSha256"
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
  const runtimeFingerprint = validateRuntimeFingerprint(payload);
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
    mcp_contract_version: runtimeFingerprint.mcpContractVersion,
    build_id: runtimeFingerprint.buildId,
    backend_git_sha: runtimeFingerprint.backendGitSha,
    tool_schema_sha256: runtimeFingerprint.toolSchemaSha256,
    build_fingerprint_sha256: runtimeFingerprint.buildFingerprintSha256,
    release_manifest_sha256: runtimeFingerprint.releaseManifestSha256,
    service_fingerprint_sha256: runtimeFingerprint.serviceFingerprintSha256,
  };

  return Promise.resolve({
    liveOk: status === 200 && payload.ok === true,
    sqliteOk:
      status === 200 &&
      payload.ok === true &&
      typeof payload.global_spine_path === "string" &&
      documentCount !== null &&
      objectCount !== null,
    contractOk: runtimeFingerprint.contractOk,
    toolParityOk: runtimeFingerprint.toolParityOk,
    fingerprintOk: runtimeFingerprint.fingerprintOk,
    fingerprintErrors: runtimeFingerprint.fingerprintErrors,
    mcpContractVersion: runtimeFingerprint.mcpContractVersion,
    buildId: runtimeFingerprint.buildId,
    backendGitSha: runtimeFingerprint.backendGitSha,
    toolSchemaSha256: runtimeFingerprint.toolSchemaSha256,
    buildFingerprintSha256: runtimeFingerprint.buildFingerprintSha256,
    releaseManifestSha256: runtimeFingerprint.releaseManifestSha256,
    serviceFingerprintSha256: runtimeFingerprint.serviceFingerprintSha256,
    env: ontologyEnv,
    releaseId: asString(payload.release_id),
    manifestPath: asString(payload.manifest_path),
    manifestValid,
    agentIndexSchemaVersion: asString(payload.agent_index_schema_version),
    indexGeneratedAt,
    companyCount,
    documentCount,
    objectCount,
    toolCount: runtimeFingerprint.toolCount,
    tools: runtimeFingerprint.tools,
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

async function requireHttpMcpToolParity(
  serverConfig: PluginMcpServerConfig,
): Promise<void> {
  const mcpUrl = getConfiguredMcpUrl(serverConfig);
  if (!mcpUrl) throw new Error("KRW Ontology MCP HTTP URL is missing");
  const client = new Client({
    name: "krw-ontology-worker-readiness",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: serverConfig.headers,
    },
  });
  const timeout = getHealthTimeoutMs();
  try {
    await client.connect(transport, { timeout });
    const result = await client.listTools(undefined, {
      timeout,
      maxTotalTimeout: timeout,
    });
    const names = result.tools.map((tool) => tool.name);
    if (!sameStringSet(names, KRW_ONTOLOGY_MCP_TOOLS)) {
      throw new Error(
        `MCP /mcp tool parity mismatch: expected ${KRW_ONTOLOGY_MCP_TOOLS.length} exact tools`,
      );
    }
  } finally {
    await client.close().catch(() => undefined);
  }
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

    if (!isHttpMcpServer(serverConfig)) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        connected: false,
        error: "KRW Ontology MCP must use explicit streamable HTTP transport",
      };
    }
    const configuredMcpUrl = getConfiguredMcpUrl(serverConfig);
    if (!configuredMcpUrl) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        connected: false,
        error: "KRW Ontology MCP HTTP URL is missing",
      };
    }
    try {
      const parsedUrl = new URL(configuredMcpUrl);
      if (
        !["http:", "https:"].includes(parsedUrl.protocol) ||
        parsedUrl.pathname.replace(/\/+$/, "") !== "/mcp" ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        throw new Error("invalid HTTP MCP URL");
      }
    } catch {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        connected: false,
        error: "KRW Ontology MCP URL must be credential-free HTTP(S) ending at /mcp",
      };
    }

    const liveHealth = await runHttpMcpHealth(serverConfig, root, probeKind);
    await requireHttpMcpToolParity(serverConfig);
    const ontologyEnv = getOntologyEnv();
    if (ontologyEnv === "staging") {
      throw new Error("KRW Ontology materialized plugin supports dev or prod only");
    }
    const pluginContract = await verifyMaterializedOntologyPluginContract({
      pluginPath,
      expectedEnvironment: ontologyEnv,
      expectedMcpContractVersion: KRW_ONTOLOGY_MCP_CONTRACT_VERSION,
      runtimeToolSchemaSha256: liveHealth.toolSchemaSha256,
      runtimeBuildFingerprintSha256: liveHealth.buildFingerprintSha256,
    });
    if (
      !liveHealth.liveOk ||
      !liveHealth.sqliteOk ||
      !liveHealth.contractOk ||
      !liveHealth.toolParityOk ||
      !liveHealth.fingerprintOk ||
      !pluginContract.ok
    ) {
      return {
        ...baseHealthResult(pluginPath, root),
        staticOk: true,
        commandOk: true,
        ...liveHealth,
        pluginContractOk: pluginContract.ok,
        pluginContractErrors: pluginContract.errors,
        pluginContentSha256: pluginContract.contentSha256,
        pluginMcpConfigSha256: pluginContract.mcpConfigSha256,
        connected: false,
        error:
          pluginContract.errors.length > 0
            ? `KRW Ontology plugin contract mismatch: ${pluginContract.errors.join("; ")}`
            : liveHealth.fingerprintErrors.length > 0
            ? `KRW Ontology MCP runtime fingerprint mismatch: ${liveHealth.fingerprintErrors.join("; ")}`
            : probeKind === "ready"
              ? "KRW Ontology MCP readiness check failed"
              : "KRW Ontology MCP live health check failed",
      };
    }

    return {
      connected: true,
      staticOk: true,
      commandOk: true,
      ...liveHealth,
      pluginContractOk: true,
      pluginContractErrors: [],
      pluginContentSha256: pluginContract.contentSha256,
      pluginMcpConfigSha256: pluginContract.mcpConfigSha256,
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

/**
 * Source-filing chat jobs call this separately from ontology readiness. The
 * filings MCP is intentionally optional for every other chat, so a disabled
 * service cannot block ordinary ontology research.
 */
export async function checkKrwFilingsMcpReady(): Promise<FilingsMcpHealthResult> {
  if (!isKrwFilingsMcpEnabled()) {
    return {
      connected: false,
      tools: [],
      error: "FILINGS_MCP_ENABLED=1 and a filings MCP auth token are required",
    };
  }
  const mcpUrl = process.env.KRW_FILINGS_MCP_URL?.trim();
  if (!mcpUrl) {
    return { connected: false, tools: [], error: "KRW_FILINGS_MCP_URL is required" };
  }
  const token = filingsMcpToken();
  const headers = { Authorization: `Bearer ${token}` };
  const timeout = getHealthTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(readyUrlFromMcpUrl(mcpUrl), {
      headers: { accept: "application/json", ...headers },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || payload?.ok !== true) {
      return { connected: false, tools: [], error: "On-demand filings MCP readiness check failed" };
    }

    const client = new Client({ name: "krw-filings-worker-readiness", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: { headers },
    });
    try {
      await client.connect(transport, { timeout });
      const result = await client.listTools(undefined, { timeout, maxTotalTimeout: timeout });
      const tools = result.tools.map((tool) => tool.name);
      if (!sameStringSet(tools, KRW_FILINGS_MCP_TOOLS)) {
        return {
          connected: false,
          tools,
          error: `On-demand filings MCP tool parity mismatch: expected ${KRW_FILINGS_MCP_TOOLS.length} exact tools`,
        };
      }
      return { connected: true, tools };
    } finally {
      await client.close().catch(() => undefined);
    }
  } catch (error) {
    return {
      connected: false,
      tools: [],
      error: error instanceof Error ? error.message : "On-demand filings MCP readiness check failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
