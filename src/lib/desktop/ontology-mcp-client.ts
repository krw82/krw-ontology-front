import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DesktopOntologyToolName } from "./ontology-contracts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_COMPACT_RESULT_TEXT_CHARS = 12_000;

export interface DesktopOntologyMcpResult {
  resultJson: Record<string, unknown>;
  resultText: string;
}

export interface DesktopOntologyMcpHealth {
  ok: boolean;
  releaseId: string | null;
  indexGeneratedAt: string | null;
  toolNames: string[];
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
      error: "KRW_ONTOLOGY_MCP_URL is not configured",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Ontology MCP health timed out")),
    readPositiveIntEnv("DESKTOP_ONTOLOGY_MCP_HEALTH_TIMEOUT_MS", 5_000),
  );
  try {
    const response = await fetch(healthUrlFromMcpUrl(mcpUrl), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const payload = asRecord(await response.json());
    return {
      ok: response.ok && payload?.ok === true,
      releaseId: stringValue(payload?.release_id),
      indexGeneratedAt: stringValue(payload?.index_generated_at),
      toolNames: stringArray(payload?.tools),
      ...(response.ok && payload?.ok === true
        ? {}
        : { error: stringValue(payload?.error) ?? `HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      ok: false,
      releaseId: null,
      indexGeneratedAt: null,
      toolNames: [],
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
        arguments: {
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
    return parseDesktopOntologyMcpResult(result);
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
    asRecord(result.answerability)?.summary,
    asRecord(result.directness_guard)?.summary,
  );
  if (summary) return summary;

  const researchStatus = firstString(
    result.research_status,
    asRecord(result.kernel)?.status,
  );
  if (researchStatus || asRecord(result.research_pack)) {
    const kernel = asRecord(result.kernel);
    const answerability = asRecord(result.answerability);
    const researchPack = asRecord(result.research_pack);
    const parts = [
      researchStatus ? `research_status: ${researchStatus}` : null,
      firstString(answerability?.recommended_answer_mode, kernel?.answer_mode)
        ? `answer_mode: ${firstString(answerability?.recommended_answer_mode, kernel?.answer_mode)}`
        : null,
      researchPack
        ? `research_pack:\n${JSON.stringify(researchPack, null, 2)}`
        : null,
      arraySummary("missing_parts", result.missing_parts),
      arraySummary("recommended_tools", result.recommended_tools),
    ].filter((part): part is string => Boolean(part));
    return boundText(parts.join("\n\n"), MAX_COMPACT_RESULT_TEXT_CHARS);
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

  return boundText(JSON.stringify(result), MAX_COMPACT_RESULT_TEXT_CHARS);
}

function arraySummary(label: string, value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return `${label}: ${JSON.stringify(value)}`;
}

function boundText(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}\n[truncated]`;
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

function healthUrlFromMcpUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
