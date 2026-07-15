import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  RESEARCH_STATE_CONTRACT_VERSION,
  validateResearchStateV2,
  type DesktopOntologyToolName,
} from "./ontology-contracts";
import {
  KRW_ONTOLOGY_MCP_CONTRACT_VERSION,
  KRW_ONTOLOGY_MCP_TOOLS,
} from "@/lib/agent/mcp-client";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESEARCH_STATE_MODEL_BYTES = 80_000;
const MAX_MCP_RESULT_WIRE_BYTES = 180_000;

export interface DesktopOntologyMcpResult {
  resultJson: Record<string, unknown>;
  resultText: string;
}

export interface DesktopOntologyMcpHealth {
  ok: boolean;
  releaseId: string | null;
  indexGeneratedAt: string | null;
  toolNames: string[];
  mcpContractVersion?: string | null;
  toolSchemaSha256?: string | null;
  error?: string;
}

export function getKrwOntologyMcpUrl(): string | null {
  const configured = process.env.KRW_ONTOLOGY_MCP_URL?.trim();
  return configured || null;
}

export function getDesktopOntologyExecutorMode():
  | "auto"
  | "mcp"
  | "catalog" {
  const value = process.env.DESKTOP_ONTOLOGY_EXECUTOR?.trim().toLowerCase();
  if (value === "mcp" || value === "catalog") return value;
  return "auto";
}

export function shouldUseDesktopOntologyMcp(): boolean {
  const mode = getDesktopOntologyExecutorMode();
  if (mode === "mcp") return true;
  if (mode === "catalog") return false;
  return Boolean(getKrwOntologyMcpUrl());
}

export async function checkKrwOntologyMcpHealth(): Promise<DesktopOntologyMcpHealth> {
  const mcpUrl = getKrwOntologyMcpUrl();
  if (!mcpUrl) {
    return {
      ok: false,
      releaseId: null,
      indexGeneratedAt: null,
      toolNames: [],
      mcpContractVersion: null,
      toolSchemaSha256: null,
      error: "KRW_ONTOLOGY_MCP_URL is not configured",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Ontology MCP health timed out")),
    readPositiveIntEnv("DESKTOP_ONTOLOGY_MCP_HEALTH_TIMEOUT_MS", 5_000),
  );
  try {
    const response = await fetch(
      process.env.KRW_ONTOLOGY_MCP_READY_URL?.trim() ||
        readyUrlFromMcpUrl(mcpUrl),
      {
      headers: { accept: "application/json" },
      signal: controller.signal,
      },
    );
    const payload = asRecord(await response.json());
    const toolNames = stringArray(payload?.tool_names);
    const contractVersion = stringValue(payload?.mcp_contract_version);
    const toolSchemaSha256 = stringValue(payload?.tool_schema_sha256);
    const contractOk =
      contractVersion === KRW_ONTOLOGY_MCP_CONTRACT_VERSION &&
      payload?.tool_names_match === true &&
      payload?.tool_count === KRW_ONTOLOGY_MCP_TOOLS.length &&
      sameStringSet(toolNames, KRW_ONTOLOGY_MCP_TOOLS) &&
      Boolean(toolSchemaSha256 && /^[a-f0-9]{64}$/.test(toolSchemaSha256));
    const ok = response.ok && payload?.ok === true && contractOk;
    return {
      ok,
      releaseId: stringValue(payload?.release_id),
      indexGeneratedAt: stringValue(payload?.index_generated_at),
      toolNames,
      mcpContractVersion: contractVersion,
      toolSchemaSha256,
      ...(ok
        ? {}
        : {
            error: contractOk
              ? stringValue(payload?.error) ?? `HTTP ${response.status}`
              : "MCP v2 contract or tool-schema readiness mismatch",
          }),
    };
  } catch (error) {
    return {
      ok: false,
      releaseId: null,
      indexGeneratedAt: null,
      toolNames: [],
      mcpContractVersion: null,
      toolSchemaSha256: null,
      error: error instanceof Error ? error.message : "Ontology MCP health failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callKrwOntologyMcpTool(
  toolName: DesktopOntologyToolName,
  args: Record<string, unknown>,
): Promise<DesktopOntologyMcpResult> {
  const url = getKrwOntologyMcpUrl();
  if (!url) {
    throw new Error("KRW_ONTOLOGY_MCP_URL is required for the MCP executor");
  }

  const client = new Client({
    name: "krw-desktop-ontology-bridge",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(url));

  try {
    await client.connect(transport, {
      timeout: readPositiveIntEnv(
        "DESKTOP_ONTOLOGY_MCP_CONNECT_TIMEOUT_MS",
        DEFAULT_TIMEOUT_MS,
      ),
    });
    const result = await client.callTool(
      {
        name: toolName,
        arguments:
          toolName === "krw_ontology_query_context"
            ? args
            : {
                ...args,
                response_format: "json",
              },
      },
      undefined,
      {
        timeout: readPositiveIntEnv(
          "DESKTOP_ONTOLOGY_MCP_TOOL_TIMEOUT_MS",
          DEFAULT_TIMEOUT_MS,
        ),
        maxTotalTimeout: readPositiveIntEnv(
          "DESKTOP_ONTOLOGY_MCP_TOOL_TIMEOUT_MS",
          DEFAULT_TIMEOUT_MS,
        ),
      },
    );

    if (result.isError) {
      throw new Error(readToolText(result) || `${toolName} returned an MCP error`);
    }
    assertSerializedBytes(result, MAX_MCP_RESULT_WIRE_BYTES, "MCP tool result");
    const parsed = parseDesktopOntologyMcpResult(result);
    if (toolName === "krw_ontology_query_context") {
      const researchState = validateResearchStateV2(parsed.resultJson);
      assertSerializedBytes(
        researchState,
        MAX_RESEARCH_STATE_MODEL_BYTES,
        RESEARCH_STATE_CONTRACT_VERSION,
      );
      return {
        resultJson: researchState,
        resultText: compactResultText(researchState),
      };
    }
    return parsed;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function parseDesktopOntologyMcpResult(
  result: unknown,
): DesktopOntologyMcpResult {
  const record = asRecord(result);
  const structured = asRecord(record?.structuredContent);
  const text = readToolText(result);

  if (structured) {
    const resultJson = asRecord(structured.result) ?? structured;
    return {
      resultJson,
      resultText: text || compactResultText(resultJson),
    };
  }

  if (text) {
    try {
      const parsed = JSON.parse(text);
      const resultJson = asRecord(parsed);
      if (resultJson) {
        return {
          resultJson,
          resultText: compactResultText(resultJson),
        };
      }
    } catch {
      return {
        resultJson: { text },
        resultText: text,
      };
    }
  }

  return {
    resultJson: record ?? { value: result },
    resultText: compactResultText(record ?? { value: result }),
  };
}

function readToolText(result: unknown): string {
  const record = asRecord(result);
  if (!Array.isArray(record?.content)) return "";
  return record.content
    .map((part) => {
      const item = asRecord(part);
      return item?.type === "text" && typeof item.text === "string"
        ? item.text
        : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function compactResultText(result: Record<string, unknown>): string {
  const summary = firstString(
    result.summary,
    asRecord(result.answerability)?.reason,
  );
  if (summary) return summary;

  if (result.contract_version === RESEARCH_STATE_CONTRACT_VERSION) {
    const answerability = asRecord(result.answerability);
    const evidenceCount = arrayLength(result.evidence_units) ?? 0;
    const calculationCount = arrayLength(result.computed_values) ?? 0;
    const parts = [
      `contract_version: ${RESEARCH_STATE_CONTRACT_VERSION}`,
      firstString(answerability?.status)
        ? `answerability: ${firstString(answerability?.status)}`
        : null,
      `evidence_units: ${evidenceCount}`,
      `computed_values: ${calculationCount}`,
      arraySummary("calculation_coverage", result.calculation_coverage),
      arraySummary("missing_parts", result.missing_parts),
      arraySummary("recommended_actions", result.recommended_actions),
    ].filter((part): part is string => Boolean(part));
    return parts.join("\n\n");
  }

  const counts = [
    ["results", arrayLength(result.results)],
    ["ticker candidates", arrayLength(result.ticker_candidates)],
    ["comparison rows", arrayLength(result.comparison_rows)],
    ["documents", arrayLength(result.documents)],
  ].filter((entry): entry is [string, number] => entry[1] !== null);
  if (counts.length) {
    return counts.map(([label, count]) => `${label}: ${count}`).join("; ");
  }

  return JSON.stringify(result);
}

function arraySummary(label: string, value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return `${label}: ${JSON.stringify(value)}`;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1_000 ? parsed : fallback;
}

function assertSerializedBytes(
  value: unknown,
  maxBytes: number,
  label: string,
): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte contract: ${bytes}`);
  }
}

function readyUrlFromMcpUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  url.pathname = "/readyz";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return (
    leftSet.size === left.length &&
    right.every((value) => leftSet.has(value))
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
